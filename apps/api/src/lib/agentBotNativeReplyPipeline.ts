import type { Bot, Contact, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { generateNativeAgentReplyWithResult } from "./agentNativeLlm.js";
import { deliverAgentReplyMessage } from "./agentVoiceReply.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { withConversationAgentReplyLock } from "./llmSharedQuotaGate.js";
import type { AutomationExecutionLogHandle } from "./automationExecutionLog.js";
import { isAgentKbDebugEnabled, logAgentKbDebug } from "./agentKnowledgeDebugLog.js";
import { mergeNativeTurnAutomationContext } from "./automationConversationContextLib.js";
import { parseAgentEngineConfig } from "./agent-engine/config/parseAgentEngineConfig.js";
import {
  isPostCompletionFollowUpMessage,
  runPostCompletionFollowUp,
  shouldSchedulePostCompletionFollowUp,
  shouldSuppressOutboundCheckInAck,
} from "./agent-engine/continuation/postCompletionFollowUp.js";
import { replyShouldPreemptEscalationTransferMessage } from "./agent-engine/quote/quoteAvailabilityReply.js";

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
  /** Evita reentrância no follow-up sintético pós-conclusão. */
  skipPostCompletionFollowUp?: boolean;
}): Promise<void> {
  const { organizationId, bot, conversation, contact, message, log, exLog } = input;
  const userMessage = (message.body ?? "").trim();
  const skipFollowUp =
    input.skipPostCompletionFollowUp === true || isPostCompletionFollowUpMessage(message);

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
    const toolOutcomes = replyResult.toolOutcomes ?? [];

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
      const callHumanOk = toolOutcomes.some(
        (t) => t.ok !== false && /^call_human$/i.test(t.name),
      );
      const deliverQuoteHandoff = replyShouldPreemptEscalationTransferMessage(replyText);

      if ((deliverQuoteHandoff || callHumanOk) && replyText.trim()) {
        try {
          await deliverAgentReplyMessage({
            organizationId,
            botId: bot.id,
            conversation,
            contact,
            inboundMessage: message,
            replyText,
            behaviorConfig: profileEsc?.behaviorConfig,
            log,
          });
        } catch (err) {
          log.warn({ err, botId: bot.id }, "Agent bot quote handoff message send failed");
          await exLog.completeError(err);
          return;
        }
        exLog.info(
          { id: "outbound", name: "Entrega" },
          callHumanOk
            ? "Resposta pós call_human enviada ao cliente (handoff humano)"
            : "Modelo C6 Escolha Confirm enviado ao cliente (handoff humano)",
          { output: { chars: replyText.length, skippedEscalationMessage: Boolean(transferConfigured) } },
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

    const profileForVoice = await prisma.automationAgentProfile.findUnique({
      where: { botId: bot.id },
      select: { behaviorConfig: true },
    });
    const behaviorConfig = profileForVoice?.behaviorConfig;

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
      const willFollowUpStream = shouldSchedulePostCompletionFollowUp({
        enabled: parseAgentEngineConfig(behaviorConfig).postCompletionFollowUpEnabled === true,
        skip: skipFollowUp,
        replyText,
        toolOutcomes,
        behaviorConfig,
        userMessage,
        isFollowUpMessage: isPostCompletionFollowUpMessage(message),
      });
      if (willFollowUpStream) {
        exLog.info(
          { id: "post_completion_follow_up", name: "Follow-up pós-conclusão" },
          "A agendar 2.º turno (Passo 8) após ack de conclusão — sem esperar o contacto",
        );
      }
      await exLog.completeSuccess();
      if (willFollowUpStream) {
        try {
          await runPostCompletionFollowUp({
            organizationId,
            bot,
            conversation,
            contact,
            sourceMessage: message,
            behaviorConfig,
            log,
            deps: { runNativeAgentReplyAndDeliver },
          });
        } catch (err) {
          log.warn(
            { err, botId: bot.id, conversationId: conversation.id },
            "post-completion follow-up schedule failed",
          );
        }
      }
      return;
    }

    try {
      const willFollowUp = shouldSchedulePostCompletionFollowUp({
        enabled: parseAgentEngineConfig(behaviorConfig).postCompletionFollowUpEnabled === true,
        skip: skipFollowUp,
        replyText,
        toolOutcomes,
        behaviorConfig,
        userMessage,
        isFollowUpMessage: isPostCompletionFollowUpMessage(message),
      });
      const suppressAck = shouldSuppressOutboundCheckInAck({
        replyText,
        willFollowUp,
        toolOutcomes,
      });

      if (!suppressAck) {
        const deliveryKind = await deliverAgentReplyMessage({
          organizationId,
          botId: bot.id,
          conversation,
          contact,
          inboundMessage: message,
          replyText,
          behaviorConfig,
          log,
        });
        exLog.info(
          { id: "outbound", name: "Entrega" },
          deliveryKind === "audio" ? "Resposta em áudio enviada (ElevenLabs)" : "Mensagem outbound enviada",
          { output: { chars: replyText.length, deliveryKind } },
        );
      } else {
        exLog.info(
          { id: "outbound", name: "Entrega" },
          "Ack S10 suprimido — Passo 8 (follow-up) será a mensagem ao contacto",
          { output: { chars: replyText.length, suppressedAck: true } },
        );
      }

      await prisma.automationInteraction
        .create({
          data: {
            organizationId,
            botId: bot.id,
            conversationId: conversation.id,
            userMessage,
            assistantMessage: suppressAck
              ? "[ack S10 suprimido — Passo 8 a seguir]"
              : replyText,
            responseType: "native_fallback",
          },
        })
        .catch(() => {});

      if (willFollowUp) {
        exLog.info(
          { id: "post_completion_follow_up", name: "Follow-up pós-conclusão" },
          "A agendar 2.º turno (Passo 8) após conclusão — sem esperar o contacto",
        );
      }

      await exLog.completeSuccess();

      if (willFollowUp) {
        try {
          await runPostCompletionFollowUp({
            organizationId,
            bot,
            conversation,
            contact,
            sourceMessage: message,
            behaviorConfig,
            log,
            deps: { runNativeAgentReplyAndDeliver },
          });
        } catch (err) {
          log.warn(
            { err, botId: bot.id, conversationId: conversation.id },
            "post-completion follow-up schedule failed",
          );
        }
      }
    } catch (err) {
      log.warn({ err, botId: bot.id }, "Agent bot native fallback send failed");
      await exLog.completeError(err);
      return;
    }

    return;
  } catch (err) {
    await exLog.completeError(err);
  }
}
