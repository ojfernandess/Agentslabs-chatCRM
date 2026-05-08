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

function inboxChannelSlug(channelType: InboxChannelType): string {
  return channelType.toLowerCase();
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

/** Payload de teste de conectividade — o integrador deve devolver 2xx e pode ignorar o corpo (`test: true`). */
export function buildAgentBotTestWebhookPayload(input: {
  organizationId: string;
  bot: Pick<Bot, "id" | "name" | "type">;
}): Record<string, unknown> {
  const { organizationId, bot } = input;
  return {
    event: "webhook_test",
    version: "openconduit-v1",
    agent_bot_id: bot.id,
    account: { id: organizationId },
    agent_bot: {
      id: bot.id,
      name: bot.name,
      type: bot.type,
    },
    test: true,
    message: "OpenConduit webhook connectivity test — return 2xx; do not treat as inbound traffic.",
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
    const sig = createHmac("sha256", secret).update(rawBody).digest("hex");
    headers["X-OpenConduit-Signature"] = `sha256=${sig}`;
  }

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
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
  const { organizationId, settings, conversation, contact, message, log } = input;
  const bot = settings.agentBot;
  if (!settings.agentBotId || !bot?.webhookUrl?.trim() || !bot.isActive) {
    return;
  }
  /** Só fila do bot: em atendimento humano (`OPEN` ou `PENDING` com atendente) o bot não deve responder. */
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
    const sig = createHmac("sha256", bot.webhookSecret.trim()).update(rawBody).digest("hex");
    headers["X-OpenConduit-Signature"] = `sha256=${sig}`;
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
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
    log.warn({ err, botId: bot.id }, "Agent bot webhook request failed");
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
