import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type {
  Prisma,
  Contact,
  Conversation,
  Message,
  Bot,
  Settings,
  Inbox,
  InboxChannelType,
} from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { loadAutomationWebhookBundle } from "./automationWebhookBundle.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { generateNativeAgentReply } from "./agentNativeLlm.js";
import { isAgentKbDebugEnabled, logAgentKbDebug } from "./agentKnowledgeDebugLog.js";
import { startAutomationExecution } from "./automationExecutionLog.js";
import { botVisualChatbotFlowId } from "./chatbotFlowTypes.js";
import { dispatchVisualChatbotFlow } from "./chatbotFlowExecutor.js";

/** UUID reservado em `event: webhook_test` quando ainda não existe bot gravado (formulário de criação). */
export const AGENT_BOT_WEBHOOK_TEST_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000001";

/** IDs sintéticos no corpo de `webhook_test` (mesma forma que `message_created`). */
export const AGENT_BOT_WEBHOOK_TEST_INBOX_ID = "00000000-0000-4000-8000-000000000010";
export const AGENT_BOT_WEBHOOK_TEST_CONVERSATION_ID = "00000000-0000-4000-8000-000000000020";
export const AGENT_BOT_WEBHOOK_TEST_CONTACT_ID = "00000000-0000-4000-8000-000000000030";
export const AGENT_BOT_WEBHOOK_TEST_MESSAGE_ID = "00000000-0000-4000-8000-000000000040";

function inboxChannelSlug(channelType: InboxChannelType): string {
  return channelType.toLowerCase();
}

/**
 * Quando há `webhookSecret`, envia:
 * - `X-OpenConduit-Signature` (HMAC sha256 do corpo, como já documentado)
 * - `X-OpenConduit-Webhook-Secret` — valor em claro (gateways que validam cabeçalho em vez de HMAC)
 * - `Authorization: Bearer <secret>` — alternativa comum a pedido de integradores ("Bearer ou x-openconduit-webhook-secret")
 */
export function applyAgentBotWebhookSecretHeaders(headers: Record<string, string>, rawBody: string, secretRaw: string): void {
  const secret = secretRaw.trim();
  if (!secret) return;
  const sig = createHmac("sha256", secret).update(rawBody).digest("hex");
  headers["X-OpenConduit-Signature"] = `sha256=${sig}`;
  headers["X-OpenConduit-Webhook-Secret"] = secret;
  headers.Authorization = `Bearer ${secret}`;
}

/** Payload JSON para webhooks do Agent Bot (`message_created`), com namespace OpenConduit. */
export function buildAgentBotWebhookPayload(input: {
  organizationId: string;
  inbox: Pick<Inbox, "id" | "name" | "channelType">;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  bot: Pick<Bot, "id" | "name" | "type" | "webhookUrl">;
  /** Perfil de automação + ferramentas (config redigida) quando existe `AutomationAgentProfile` para o bot. */
  automation?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { organizationId, inbox, conversation, contact, message, bot, automation } = input;
  const base: Record<string, unknown> = {
    event: "message_created",
    version: "openconduit-v1",
    /** Alias Chatwoot-friendly (sempre igual a `agent_bot.id`). */
    agent_bot_id: bot.id,
    /** ID estável da caixa de entrada (UUID), no modelo Chatwoot. */
    inbox_id: inbox.id,
    account: { id: organizationId },
    inbox: {
      id: inbox.id,
      name: inbox.name,
      channel: inboxChannelSlug(inbox.channelType),
    },
    conversation: {
      id: conversation.id,
      status: conversation.status,
      contact_id: contact.id,
      inbox_id: conversation.inboxId,
    },
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
    },
    message: {
      id: message.id,
      direction: message.direction,
      type: message.type,
      body: message.body,
      media_url: message.mediaUrl,
      media_type: message.mediaType,
      provider_msg_id: message.providerMsgId,
      created_at: message.createdAt.toISOString(),
    },
    agent_bot: {
      id: bot.id,
      name: bot.name,
      type: bot.type,
    },
  };
  if (automation && typeof automation === "object" && Object.keys(automation).length > 0) {
    base.automation = automation;
  }
  return base;
}

/** Payload de teste: mesma forma aninhada que `message_created` + `test: true` para o integrador ignorar. */
export function buildAgentBotTestWebhookPayload(input: {
  organizationId: string;
  bot: Pick<Bot, "id" | "name" | "type">;
  automation?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { organizationId, bot, automation } = input;
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    event: "webhook_test",
    version: "openconduit-v1",
    test: true,
    agent_bot_id: bot.id,
    inbox_id: AGENT_BOT_WEBHOOK_TEST_INBOX_ID,
    account: { id: organizationId },
    inbox: {
      id: AGENT_BOT_WEBHOOK_TEST_INBOX_ID,
      name: "OpenConduit connectivity test",
      channel: "whatsapp",
    },
    conversation: {
      id: AGENT_BOT_WEBHOOK_TEST_CONVERSATION_ID,
      status: "PENDING",
      contact_id: AGENT_BOT_WEBHOOK_TEST_CONTACT_ID,
      inbox_id: AGENT_BOT_WEBHOOK_TEST_INBOX_ID,
    },
    contact: {
      id: AGENT_BOT_WEBHOOK_TEST_CONTACT_ID,
      name: "Connectivity test",
      phone: "+00000000000",
    },
    message: {
      id: AGENT_BOT_WEBHOOK_TEST_MESSAGE_ID,
      direction: "INBOUND",
      type: "TEXT",
      body: "Synthetic inbound for webhook_test — ignore when test is true or event is webhook_test.",
      media_url: null,
      media_type: null,
      provider_msg_id: null,
      created_at: now,
    },
    agent_bot: {
      id: bot.id,
      name: bot.name,
      type: bot.type,
    },
  };
  if (automation && typeof automation === "object" && Object.keys(automation).length > 0) {
    base.automation = automation;
  }
  return base;
}

export type AgentBotTestWebhookResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  error?: string;
  responseBodySnippet?: string;
};

function botManagedByOpenConduit(config: unknown): boolean {
  if (config == null || typeof config !== "object") return false;
  const v = (config as { automationManagedByOpenConduit?: unknown }).automationManagedByOpenConduit;
  return v === true;
}

/** Texto em `behaviorConfig.escalationRules.transferMessage` (Regras de escalonamento no painel). */
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
  const preview = (params.message.body ?? "").trim().slice(0, 500);
  const state = {
    source: "native_agent",
    lastInboundMessageId: params.message.id,
    lastInboundAt: params.message.createdAt.toISOString(),
    lastPreview: preview,
  };
  await prisma.automationConversationContext.upsert({
    where: { conversationId: params.conversationId },
    create: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      botId: params.botId,
      state,
    },
    update: {
      botId: params.botId,
      state,
    },
  });
}

async function dispatchAgentBotNativeFallback(input: {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { organizationId, bot, conversation, contact, message, log } = input;
  const userMessage = (message.body ?? "").trim();

  const exLog = await startAutomationExecution({
    organizationId,
    botId: bot.id,
    conversationId: conversation.id,
    triggerMessageId: message.id,
    workflowKey: "native_agent",
    workflowName: bot.name.slice(0, 200),
    log,
  });
  exLog.info(
    { id: "inbound", name: "Webhook inbound" },
    "Mensagem recebida — fluxo nativo OpenConduit",
    { input: { messageId: message.id, userMessage: userMessage.slice(0, 4000) } },
  );

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

    const replyText = await generateNativeAgentReply({
      organizationId,
      bot,
      conversation,
      message,
      log,
      executionLog: exLog.child("agent_llm"),
    });

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

    try {
      await deliverOutboundWhatsAppMessage({
        organizationId,
        data: {
          contactId: contact.id,
          conversationId: conversation.id,
          type: "TEXT",
          body: replyText,
        },
        actor: { kind: "agent_bot", botId: bot.id },
        log,
        newConversation: { status: "PENDING", assignedToId: null },
      });
    } catch (err) {
      log.warn({ err, botId: bot.id }, "Agent bot native fallback send failed");
      await exLog.completeError(err);
      return;
    }

    exLog.info(
      { id: "outbound", name: "Entrega" },
      "Mensagem outbound enviada",
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
  } catch (err) {
    await exLog.completeError(err);
  }
}

/**
 * POST de prova para a URL configurada (admin). Não grava interação nem dispara lógica de mensagem.
 */
export async function deliverAgentBotTestWebhook(input: {
  webhookUrl: string;
  webhookSecret: string | null | undefined;
  organizationId: string;
  bot: Pick<Bot, "id" | "name" | "type">;
  log: FastifyBaseLogger;
}): Promise<AgentBotTestWebhookResult> {
  const { webhookUrl, webhookSecret, organizationId, bot, log } = input;
  const url = webhookUrl.trim();
  if (!url) {
    return { ok: false, latencyMs: 0, error: "missing_webhook_url" };
  }

  const automation = await loadAutomationWebhookBundle(organizationId, bot.id);
  const bodyObj = buildAgentBotTestWebhookPayload({ organizationId, bot, automation });
  const rawBody = JSON.stringify(bodyObj);
  const deliveryId = randomUUID();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenConduit-AgentBot/1",
    "X-OpenConduit-Event": "webhook_test",
    "X-OpenConduit-Delivery": deliveryId,
  };

  const secret =
    webhookSecret === null || webhookSecret === undefined
      ? ""
      : typeof webhookSecret === "string"
        ? webhookSecret.trim()
        : "";
  if (secret) {
    applyAgentBotWebhookSecretHeaders(headers, rawBody, secret);
  }

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 28_000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const latencyMs = Date.now() - t0;
    const snippet = (await res.text().catch(() => "")).slice(0, 500);
    const ok = res.ok;
    if (!ok) {
      log.warn({ status: res.status, botId: bot.id }, "Agent bot test webhook returned non-OK");
    }
    return {
      ok,
      httpStatus: res.status,
      latencyMs,
      responseBodySnippet: snippet || undefined,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, botId: bot.id }, "Agent bot test webhook request failed");
    return {
      ok: false,
      latencyMs,
      error: msg,
    };
  }
}

export async function dispatchAgentBotWebhook(input: {
  organizationId: string;
  settings: Pick<Settings, "agentBotId"> & { agentBot: Bot | null };
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { organizationId, settings, contact, message, log } = input;
  let conversation = input.conversation;
  const bot = settings.agentBot;
  if (!settings.agentBotId || !bot?.isActive) {
    return;
  }
  if (conversation.awaitingHumanHandoff) {
    return;
  }
  /** `OPEN` sem atendente com bot activo deve estar na fila como `PENDING` (reabertura manual, etc.). */
  if (conversation.assignedToId == null && conversation.status === "OPEN") {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "PENDING", updatedAt: new Date() },
    });
  }
  /** Só fila do bot: com atendente humano não enviamos. */
  if (conversation.status !== "PENDING" || conversation.assignedToId != null) {
    return;
  }

  const hasExternalWebhook = Boolean(bot.webhookUrl?.trim());
  const nativeManaged = botManagedByOpenConduit(bot.config);
  const visualFlowId = !hasExternalWebhook ? botVisualChatbotFlowId(bot.config) : null;
  if (isAgentKbDebugEnabled()) {
    logAgentKbDebug(log, {
      stage: "dispatchAgentBotWebhook",
      organizationId,
      botId: bot.id,
      conversationId: conversation.id,
      hasExternalWebhook,
      nativeManaged,
      visualFlowId,
      path: hasExternalWebhook
        ? "external_webhook"
        : visualFlowId
          ? "visual_chatbot"
          : !hasExternalWebhook && nativeManaged
            ? "native_openconduit"
            : "none",
    });
  }

  if (!hasExternalWebhook && visualFlowId) {
    const chatbotFlow = await prisma.chatbotFlow.findFirst({
      where: {
        id: visualFlowId,
        organizationId,
        OR: [{ isPublished: true }, { linkedBotId: bot.id }],
      },
    });
    if (chatbotFlow) {
      await dispatchVisualChatbotFlow({
        organizationId,
        bot,
        chatbotFlow,
        conversation,
        contact,
        message,
        log,
      });
      return;
    }
    log.warn({ botId: bot.id, visualFlowId }, "visual chatbot flow not found or not published");
  }

  if (!hasExternalWebhook) {
    if (!nativeManaged) {
      if (isAgentKbDebugEnabled()) {
        logAgentKbDebug(log, {
          stage: "dispatchAgentBotWebhook_skipped",
          reason: "bot_config_missing_automation_managed_by_openconduit",
          botId: bot.id,
          conversationId: conversation.id,
        });
      }
      return;
    }
    await dispatchAgentBotNativeFallback({
      organizationId,
      bot,
      conversation,
      contact,
      message,
      log,
    });
    return;
  }

  if (isAgentKbDebugEnabled()) {
    logAgentKbDebug(log, {
      stage: "dispatchAgentBotWebhook_external",
      botId: bot.id,
      conversationId: conversation.id,
      note:
        "Com webhookUrl definido, a resposta e a KB vêm do integrador externo; o agente nativo OpenConduit (RAG buscar_conhecimento) não é executado.",
    });
  }
  const webhookUrl = bot.webhookUrl!.trim();

  const inbox = await prisma.inbox.findFirst({
    where: { id: conversation.inboxId, organizationId },
    select: { id: true, name: true, channelType: true },
  });
  if (!inbox) {
    log.warn(
      { conversationId: conversation.id, inboxId: conversation.inboxId },
      "Agent bot webhook skipped: inbox not found for organization",
    );
    return;
  }

  const automation = await loadAutomationWebhookBundle(organizationId, bot.id);
  const bodyObj = buildAgentBotWebhookPayload({
    organizationId,
    inbox,
    conversation,
    contact,
    message,
    bot,
    automation,
  });
  const rawBody = JSON.stringify(bodyObj);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenConduit-AgentBot/1",
    "X-OpenConduit-Event": "message_created",
    "X-OpenConduit-Delivery": message.id,
  };

  if (bot.webhookSecret?.trim()) {
    applyAgentBotWebhookSecretHeaders(headers, rawBody, bot.webhookSecret);
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 28_000);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      log.warn({ status: res.status, body: txt.slice(0, 500), botId: bot.id }, "Agent bot webhook returned non-OK");
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    log.warn(
      { err, botId: bot.id, aborted, hint: aborted ? "webhook_url_timeout_28s" : undefined },
      "Agent bot webhook request failed",
    );
  }

  await prisma.botInteraction
    .create({
      data: {
        botId: bot.id,
        direction: "outbound_webhook",
        payload: bodyObj as Prisma.InputJsonValue,
        conversationId: conversation.id,
      },
    })
    .catch(() => {});
}

/** Comparação segura do cabeçalho recebido pelo integrador (opcional). */
export function verifyOpenConduitSignature(rawBody: string, secret: string, headerValue: string | undefined): boolean {
  if (!secret.trim() || !headerValue?.startsWith("sha256=")) return false;
  const theirs = headerValue.slice(7).trim();
  const mine = createHmac("sha256", secret.trim()).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(theirs, "utf8");
    const b = Buffer.from(mine, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
