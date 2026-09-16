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
import { broadcastConversationAgentTyping } from "./workspaceHub.js";
import {
  getInteractionBudgetState,
  markInteractionBudgetHumanActive,
  parseInteractionLimitFromBehavior,
  registerAgentInteraction,
  shouldAppendWebchatLinkOnReply,
  type InteractionBudgetState,
} from "./interactionBudget.js";
import { callHumanForConversationForOrg } from "./conversationNativeToolActions.js";
import { attachInteractionNumberToLedger } from "./messageBillingLedger.js";
import {
  enrichReplyWithWebchatLink,
  replyContainsWebchatUrl,
  sendWebchatContinuityLinkToContact,
} from "./webchatSession.js";

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
  /** Texto merged quando inbound message batch está activo. */
  userMessageOverride?: string;
  batchedMessageIds?: string[];
}): Promise<void> {
  const { organizationId, bot, conversation, contact, message, log, exLog } = input;
  const userMessage = (input.userMessageOverride ?? message.body ?? "").trim();
  const skipFollowUp =
    input.skipPostCompletionFollowUp === true || isPostCompletionFollowUpMessage(message);

  broadcastConversationAgentTyping(organizationId, conversation.id, {
    typing: true,
    botId: bot.id,
    botName: bot.name,
  });

  try {
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

    /** Interaction Policy: gate ANTES da geração — nenhuma resposta automática após o limite. */
    let budgetState: InteractionBudgetState | null = null;
    try {
      const profilePre = await prisma.automationAgentProfile.findUnique({
        where: { botId: bot.id },
        select: { behaviorConfig: true },
      });
      budgetState = await getInteractionBudgetState({
        organizationId,
        conversationId: conversation.id,
        behaviorConfig: profilePre?.behaviorConfig,
      });
    } catch (err) {
      log.warn({ err, conversationId: conversation.id }, "interaction budget state load failed");
    }
    if (budgetState?.enabled && budgetState.blocked) {
      const convNow = await prisma.conversation.findFirst({
        where: { id: conversation.id },
        select: { awaitingHumanHandoff: true },
      });
      if (!convNow?.awaitingHumanHandoff) {
        await callHumanForConversationForOrg(prisma, {
          organizationId,
          conversationId: conversation.id,
          reason: `INTERACTION_LIMIT_REACHED — ${budgetState.count}/${budgetState.limit} interações (transferência automática)`,
          userMessageSnippet: userMessage,
          log,
        });
        await markInteractionBudgetHumanActive(conversation.id);
      }
      exLog.info(
        { id: "interaction_budget", name: "Controle de atendimento" },
        "Limite de interações atingido — resposta automática bloqueada; conversa em atendimento humano",
        { output: { interactionCount: budgetState.count, interactionLimit: budgetState.limit } },
      );
      await exLog.completeSuccess();
      return;
    }

    /** Regista 1 interação após resposta efetivamente enviada; ao atingir o limite → call_human (sem 11ª mensagem). */
    const maybeEnrichReplyForWebchat = async (
      replyText: string,
      behaviorConfig: unknown,
    ): Promise<string> => {
      if (!shouldAppendWebchatLinkOnReply(behaviorConfig, budgetState)) return replyText;
      try {
        const enriched = await enrichReplyWithWebchatLink({
          organizationId,
          conversationId: conversation.id,
          replyText,
        });
        return enriched.replyText;
      } catch (err) {
        log.warn({ err, conversationId: conversation.id }, "webchat link enrich failed");
        return replyText;
      }
    };

    const registerBudgetAfterDelivery = async (
      deliveredOk: boolean,
      messageId?: string,
      deliveredBody?: string,
    ): Promise<void> => {
      if (!deliveredOk || !budgetState?.enabled || budgetState.limit == null) return;
      try {
        const r = await registerAgentInteraction({
          organizationId,
          conversationId: conversation.id,
          agentBotId: bot.id,
          limit: budgetState.limit,
        });
        if (messageId) {
          await attachInteractionNumberToLedger({ messageId, interactionNumber: r.count });
        }
        if (r.limitReached) {
          exLog.info(
            { id: "interaction_budget", name: "Controle de atendimento" },
            "INTERACTION_LIMIT_REACHED — transferência automática para atendimento humano (call_human)",
            { output: { interactionCount: r.count, interactionLimit: r.limit, automatic: true } },
          );
          const cfg = parseInteractionLimitFromBehavior(profilePre?.behaviorConfig);
          if (
            cfg.offerWebchatOnLimit &&
            deliveredBody &&
            !replyContainsWebchatUrl(deliveredBody)
          ) {
            try {
              await sendWebchatContinuityLinkToContact({
                organizationId,
                conversationId: conversation.id,
                contactId: contact.id,
                botId: bot.id,
                log,
              });
            } catch (err) {
              log.warn({ err, conversationId: conversation.id }, "webchat continuity fallback send failed");
            }
          }
          await callHumanForConversationForOrg(prisma, {
            organizationId,
            conversationId: conversation.id,
            reason: `INTERACTION_LIMIT_REACHED — ${r.count}/${r.limit} interações (transferência automática)`,
            userMessageSnippet: userMessage,
            log,
          });
          await markInteractionBudgetHumanActive(conversation.id);
        } else if (r.nearLimit) {
          exLog.info(
            { id: "interaction_budget", name: "Controle de atendimento" },
            "INTERACTION_LIMIT_NEAR — modo economia ativo",
            { output: { interactionCount: r.count, interactionLimit: r.limit, remaining: r.remaining } },
          );
        }
      } catch (err) {
        log.warn({ err, conversationId: conversation.id }, "interaction budget register failed");
      }
    };

    const replyResult = await withConversationAgentReplyLock(conversation.id, () =>
      generateNativeAgentReplyWithResult({
        organizationId,
        bot,
        conversation,
        message,
        log,
        executionLog: exLog.child("agent_llm"),
        contactId: contact.id,
        userMessageOverride: input.userMessageOverride,
        batchedMessageIds: input.batchedMessageIds,
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

      if (deliverQuoteHandoff && replyText.trim()) {
        const quoteReplyText = await maybeEnrichReplyForWebchat(replyText, profileEsc?.behaviorConfig);
        try {
          await deliverAgentReplyMessage({
            organizationId,
            botId: bot.id,
            conversation,
            contact,
            inboundMessage: message,
            replyText: quoteReplyText,
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
          { output: { chars: quoteReplyText.length, skippedEscalationMessage: Boolean(transferConfigured) } },
        );
        await prisma.automationInteraction
          .create({
            data: {
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              userMessage,
              assistantMessage: quoteReplyText,
              responseType: "native_fallback",
            },
          })
          .catch(() => {});
        await registerBudgetAfterDelivery(true, undefined, quoteReplyText);
        await exLog.completeSuccess();
        return;
      }

      if (transferConfigured) {
        const transferBody = await maybeEnrichReplyForWebchat(transferConfigured, profileEsc?.behaviorConfig);
        try {
          await deliverOutboundWhatsAppMessage({
            organizationId,
            data: {
              contactId: contact.id,
              conversationId: conversation.id,
              type: "TEXT",
              body: transferBody,
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
          { output: { chars: transferBody.length, modelReplyChars: replyText.length } },
        );
        await prisma.automationInteraction
          .create({
            data: {
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              userMessage,
              assistantMessage: transferBody,
              responseType: "native_fallback",
            },
          })
          .catch(() => {});
        await registerBudgetAfterDelivery(true, undefined, transferBody);
        await exLog.completeSuccess();
        return;
      }
      if (shouldAppendWebchatLinkOnReply(profileEsc?.behaviorConfig, budgetState)) {
        try {
          await sendWebchatContinuityLinkToContact({
            organizationId,
            conversationId: conversation.id,
            contactId: contact.id,
            botId: bot.id,
            log,
            skipIfBodyContains: replyText,
          });
        } catch (err) {
          log.warn({ err, conversationId: conversation.id }, "webchat continuity send on handoff failed");
        }
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
      await registerBudgetAfterDelivery(true, undefined, replyText);
      if (shouldAppendWebchatLinkOnReply(behaviorConfig, budgetState) && !replyContainsWebchatUrl(replyText)) {
        try {
          await sendWebchatContinuityLinkToContact({
            organizationId,
            conversationId: conversation.id,
            contactId: contact.id,
            botId: bot.id,
            log,
          });
        } catch (err) {
          log.warn({ err, conversationId: conversation.id }, "webchat continuity send after stream failed");
        }
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
        const enrichedReplyText = await maybeEnrichReplyForWebchat(replyText, behaviorConfig);
        const delivery = await deliverAgentReplyMessage({
          organizationId,
          botId: bot.id,
          conversation,
          contact,
          inboundMessage: message,
          replyText: enrichedReplyText,
          behaviorConfig,
          log,
        });
        exLog.info(
          { id: "outbound", name: "Entrega" },
          delivery.kind === "audio" ? "Resposta em áudio enviada" : "Mensagem outbound enviada",
          { output: { chars: enrichedReplyText.length, deliveryKind: delivery.kind } },
        );
        /** Só conta interação quando efetivamente enviada (tentativas FAILED não contam). */
        await registerBudgetAfterDelivery(
          delivery.message.status !== "FAILED",
          delivery.message.id,
          enrichedReplyText,
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
  } finally {
    broadcastConversationAgentTyping(organizationId, conversation.id, {
      typing: false,
      botId: bot.id,
      botName: bot.name,
    });
  }
}
