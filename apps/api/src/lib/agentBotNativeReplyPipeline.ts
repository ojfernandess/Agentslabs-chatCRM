import type { Bot, Contact, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { generateNativeAgentReplyWithResult } from "./agentNativeLlm.js";
import { deliverAgentReplyMessage } from "./agentVoiceReply.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { withConversationAgentReplyLock } from "./llmSharedQuotaGate.js";
import type { AutomationExecutionLogHandle } from "./automationExecutionLog.js";
import { isAgentKbDebugEnabled, logAgentKbDebug } from "./agentKnowledgeDebugLog.js";
import {
  mergeNativeTurnAutomationContext,
  loadAutomationConversationContext,
} from "./automationConversationContextLib.js";
import { isContinuationSyntheticMessage } from "./agent-engine/continuation/constants.js";
import { maybeScheduleAgentContinuation } from "./agent-engine/continuation/scheduleAgentContinuation.js";

function parseEscalationTransferMessage(behaviorConfig: unknown): string {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return "";
  const esc = (behaviorConfig as Record<string, unknown>).escalationRules;
  if (!esc || typeof esc !== "object") return "";
  const tm = (esc as Record<string, unknown>).transferMessage;
  if (typeof tm !== "string") return "";
  return tm.trim().slice(0, 4000);
}

async function upsertAutomationConversationContextForNative(params: {
  organizationId: string;
  conversationId: string;
  botId: string;
  message: Message;
}): Promise<void> {
  await mergeNativeTurnAutomationContext({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    botId: params.botId,
    message: params.message,
  });
}

/** Gera resposta nativa e entrega ao cliente — partilhado entre webhook sync e fila BullMQ. */
export async function runNativeAgentReplyAndDeliver(input: {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
  exLog: AutomationExecutionLogHandle;
  /** Evita re-agendar continuação quando este turno já é proactivo. */
  skipContinuationSchedule?: boolean;
}): Promise<void> {
  const { organizationId, bot, conversation, contact, message, log, exLog, skipContinuationSchedule } = input;
  const userMessage = (message.body ?? "").trim();

  if (isAgentKbDebugEnabled()) {
    logAgentKbDebug(log, {
      stage: "dispatchAgentBotNativeFallback",
      organizationId,
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id,
      executionId: exLog.getExecutionId(),
    });
  }

  try {
    try {
      await upsertAutomationConversationContextForNative({
        organizationId,
        conversationId: conversation.id,
        botId: bot.id,
        message,
      });
      exLog.debug({ id: "context", name: "Contexto automação" }, "Estado de contexto actualizado");
    } catch (err) {
      log.warn({ err, conversationId: conversation.id }, "automation conversation context upsert failed");
      exLog.warn({ id: "context", name: "Contexto automação" }, "Upsert de contexto falhou", {
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    const replyResult = await withConversationAgentReplyLock(conversation.id, () =>
      generateNativeAgentReplyWithResult({
        organizationId,
        bot,
        conversation,
        message,
        log,
        executionLog: exLog.child("agent_llm"),
        contactId: contact.id,
      }),
    );
    const replyText = replyResult.reply;
    const clientStreamDelivered = replyResult.clientStreamDelivered === true;

    const handoffAfter = await prisma.conversation.findFirst({
      where: { id: conversation.id },
      select: { awaitingHumanHandoff: true },
    });
    if (handoffAfter?.awaitingHumanHandoff) {
      const profileEsc = await prisma.automationAgentProfile.findUnique({
        where: { botId: bot.id },
        select: { behaviorConfig: true },
      });
      const transferConfigured = parseEscalationTransferMessage(profileEsc?.behaviorConfig);
      if (transferConfigured) {
        try {
          await deliverOutboundWhatsAppMessage({
            organizationId,
            data: {
              contactId: contact.id,
              conversationId: conversation.id,
              type: "TEXT",
              body: transferConfigured,
            },
            actor: { kind: "agent_bot", botId: bot.id },
            log,
            newConversation: { status: "PENDING", assignedToId: null },
          });
        } catch (err) {
          log.warn({ err, botId: bot.id }, "Agent bot escalation transfer message send failed");
          await exLog.completeError(err);
          return;
        }
        exLog.info(
          { id: "outbound", name: "Resposta" },
          "Transferência para humano — mensagem das regras de escalonamento enviada ao cliente",
          { output: { chars: transferConfigured.length, modelReplyChars: replyText.length } },
        );
        await prisma.automationInteraction
          .create({
            data: {
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              userMessage,
              assistantMessage: transferConfigured,
              responseType: "native_fallback",
            },
          })
          .catch(() => {});
        await exLog.completeSuccess();
        return;
      }
      exLog.info(
        { id: "outbound", name: "Resposta" },
        "Transferência para humano — resposta do modelo não enviada ao cliente",
        { output: { replyChars: replyText.length } },
      );
      await exLog.completeSuccess();
      return;
    }

    if (!replyText) {
      exLog.info({ id: "outbound", name: "Resposta" }, "Modelo devolveu texto vazio — sem envio");
      await exLog.completeSuccess();
      return;
    }

    if (clientStreamDelivered) {
      exLog.info(
        { id: "outbound", name: "Entrega" },
        "Resposta entregue em chunks durante geração (streaming outbound)",
        { output: { chars: replyText.length } },
      );
      await prisma.automationInteraction
        .create({
          data: {
            organizationId,
            botId: bot.id,
            conversationId: conversation.id,
            userMessage,
            assistantMessage: replyText,
            responseType: "native_fallback",
          },
        })
        .catch(() => {});
      await exLog.completeSuccess();
      return;
    }

    const profileForVoice = await prisma.automationAgentProfile.findUnique({
      where: { botId: bot.id },
      select: { behaviorConfig: true },
    });

    try {
      const deliveryKind = await deliverAgentReplyMessage({
        organizationId,
        botId: bot.id,
        conversation,
        contact,
        inboundMessage: message,
        replyText,
        behaviorConfig: profileForVoice?.behaviorConfig,
        log,
      });
      exLog.info(
        { id: "outbound", name: "Entrega" },
        deliveryKind === "audio" ? "Resposta em áudio enviada (ElevenLabs)" : "Mensagem outbound enviada",
        { output: { chars: replyText.length, deliveryKind } },
      );
    } catch (err) {
      log.warn({ err, botId: bot.id }, "Agent bot native fallback send failed");
      await exLog.completeError(err);
      return;
    }

    await prisma.automationInteraction
      .create({
        data: {
          organizationId,
          botId: bot.id,
          conversationId: conversation.id,
          userMessage,
          assistantMessage: replyText,
          responseType: "native_fallback",
        },
      })
      .catch(() => {});

    if (!skipContinuationSchedule && !isContinuationSyntheticMessage(message.body)) {
      try {
        const profile = await prisma.automationAgentProfile.findUnique({
          where: { botId: bot.id },
          select: { behaviorConfig: true },
        });
        const ctxRow = await loadAutomationConversationContext(conversation.id);
        const toolRound = ctxRow.state.lastNativeToolRound;
        const scheduled = await maybeScheduleAgentContinuation({
          organizationId,
          botId: bot.id,
          conversationId: conversation.id,
          contactId: contact.id,
          executionId: exLog.getExecutionId(),
          behaviorConfig: profile?.behaviorConfig,
          turnCtx: {
            userMessage,
            replyText,
            toolRound: toolRound
              ? {
                  tools: toolRound.tools,
                  resultDeliveredToCustomer: toolRound.resultDeliveredToCustomer,
                }
              : undefined,
            flowStep: ctxRow.state.flowStep,
            flowSlots: ctxRow.state.flowSlots,
          },
          log,
        });
        if (scheduled.scheduled) {
          exLog.info(
            { id: "continuation", name: "Continuação proactiva" },
            "Regra(s) de continuação agendada(s) para turno seguinte",
            { output: { ruleIds: scheduled.ruleIds } },
          );
        }
      } catch (err) {
        log.warn({ err, conversationId: conversation.id }, "agent continuation schedule failed");
      }
    }

    await exLog.completeSuccess();
  } catch (err) {
    await exLog.completeError(err);
  }
}
