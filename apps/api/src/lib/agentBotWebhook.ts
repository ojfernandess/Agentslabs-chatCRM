import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, Contact, Conversation, Message, Bot, Settings } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";

/** Payload inspirado em Chatwoot (`message_created` / webhooks), com namespace OpenConduit. */
export function buildAgentBotWebhookPayload(input: {
  organizationId: string;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  bot: Pick<Bot, "id" | "name" | "type" | "webhookUrl">;
}): Record<string, unknown> {
  const { organizationId, conversation, contact, message, bot } = input;
  return {
    event: "message_created",
    version: "openconduit-v1",
    account: { id: organizationId },
    inbox: { id: organizationId, channel: "whatsapp" },
    conversation: {
      id: conversation.id,
      status: conversation.status,
      contact_id: contact.id,
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

  const bodyObj = buildAgentBotWebhookPayload({
    organizationId,
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
