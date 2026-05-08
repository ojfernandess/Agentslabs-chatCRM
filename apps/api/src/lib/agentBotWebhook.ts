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
}): Record<string, unknown> {
  const { organizationId, inbox, conversation, contact, message, bot } = input;
  return {
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
}

/** Payload de teste: mesma forma aninhada que `message_created` + `test: true` para o integrador ignorar. */
export function buildAgentBotTestWebhookPayload(input: {
  organizationId: string;
  bot: Pick<Bot, "id" | "name" | "type">;
}): Record<string, unknown> {
  const { organizationId, bot } = input;
  const now = new Date().toISOString();
  return {
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
}

export type AgentBotTestWebhookResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  error?: string;
  responseBodySnippet?: string;
};

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

  const bodyObj = buildAgentBotTestWebhookPayload({ organizationId, bot });
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
  if (!settings.agentBotId || !bot?.webhookUrl?.trim() || !bot.isActive) {
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

  const bodyObj = buildAgentBotWebhookPayload({
    organizationId,
    inbox,
    conversation,
    contact,
    message,
    bot,
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
    const res = await fetch(bot.webhookUrl.trim(), {
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
