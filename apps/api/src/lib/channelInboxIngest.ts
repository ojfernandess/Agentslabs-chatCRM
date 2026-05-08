import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { InboxChannelType, MessageType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import { dispatchAgentBotWebhook } from "./agentBotWebhook.js";
import { getAgentBotDispatchContextForInbox } from "./agentBotTriage.js";
import { ensureConversationForChannelInbox } from "./conversationRouting.js";

export function newIngestToken(): string {
  return randomBytes(32).toString("hex");
}

/** Chave única por participante + canal (evita colidir com telefones E.164). */
export function participantPhoneKey(channelType: InboxChannelType, participantId: string): string {
  const safeId = participantId.replace(/\|/g, "_").replace(/\s+/g, " ").trim().slice(0, 400);
  return `oc|${channelType}|${safeId}`;
}

export type ChannelInboundInput = {
  organizationId: string;
  inboxId: string;
  channelType: InboxChannelType;
  participantId: string;
  participantName?: string;
  email?: string | null;
  body?: string | null;
  type?: MessageType;
  mediaUrl?: string | null;
  mediaType?: string | null;
  externalMessageId?: string | null;
  log: FastifyBaseLogger;
};

export async function processChannelInboxInbound(input: ChannelInboundInput): Promise<{
  conversationId: string;
  messageId: string;
  contactId: string;
}> {
  const {
    organizationId,
    inboxId,
    channelType,
    participantId,
    participantName,
    email,
    body,
    type = "TEXT",
    mediaUrl,
    mediaType,
    externalMessageId,
    log,
  } = input;

  const phone = participantPhoneKey(channelType, participantId);
  const displayName =
    participantName?.trim() ||
    (channelType === "EMAIL" && email ? email : null) ||
    participantId;

  let contact = await prisma.contact.findFirst({
    where: { organizationId, phone },
  });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: displayName,
        email:
          email?.trim() ||
          (channelType === "EMAIL" ? participantId.trim() : undefined) ||
          undefined,
      },
    });
  } else if (email?.trim() && !contact.email) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { email: email.trim() },
    });
  }

  if (externalMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        providerMsgId: externalMessageId,
        conversation: { organizationId, inboxId },
      },
      select: { id: true, conversationId: true, conversation: { select: { contactId: true } } },
    });
    if (existing) {
      return {
        conversationId: existing.conversationId,
        messageId: existing.id,
        contactId: existing.conversation.contactId,
      };
    }
  }

  const channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  const lockSingleConversation = channelSettings?.lockSingleConversation ?? false;
  const agentCtx = await getAgentBotDispatchContextForInbox(organizationId, inboxId);
  const useAgentBot = Boolean(agentCtx);

  const conversation = await ensureConversationForChannelInbox({
    organizationId,
    contactId: contact.id,
    inboxId,
    lockSingleConversation,
    activeConversationStatus: useAgentBot ? "PENDING" : "OPEN",
    createDefaults: {
      status: useAgentBot ? "PENDING" : "OPEN",
      assignedToId: null,
    },
  });

  const inbound = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      type,
      body: body ?? null,
      mediaUrl: mediaUrl ?? null,
      mediaType: mediaType ?? null,
      providerMsgId: externalMessageId ?? null,
      status: "DELIVERED",
    },
  });

  const channelTag = channelType.toLowerCase();

  await appendTimelineEvent({
    organizationId,
    subjectType: "CONTACT",
    subjectId: contact.id,
    eventType: "message.inbound",
    channel: channelTag,
    payload: {
      messageId: inbound.id,
      conversationId: conversation.id,
      type,
      body: body ?? null,
      mediaUrl: mediaUrl ?? null,
      providerMsgId: externalMessageId ?? null,
      inboxId,
    } as Prisma.InputJsonValue,
    sourceId: externalMessageId ?? inbound.id,
    occurredAt: new Date(),
  }).catch((err) => {
    log.warn({ err }, "channel inbox: timeline append failed");
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  const inboundBody = body?.trim() ?? "";
  if (inboundBody) {
    const rules = await prisma.autoTagRule.findMany({ where: { organizationId } });
    for (const rule of rules) {
      if (inboundBody.toLowerCase().includes(rule.keyword.toLowerCase())) {
        await prisma.contactTag.upsert({
          where: {
            contactId_tagId: { contactId: contact.id, tagId: rule.tagId },
          },
          create: { contactId: contact.id, tagId: rule.tagId },
          update: {},
        });
      }
    }
  }

  if (useAgentBot && agentCtx) {
    const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
    if (fresh) {
      void dispatchAgentBotWebhook({
        organizationId,
        settings: {
          agentBotId: agentCtx.agentBotId,
          agentBot: agentCtx.agentBot,
        },
        conversation: fresh,
        contact,
        message: inbound,
        log,
      });
    }
  }

  return {
    conversationId: conversation.id,
    messageId: inbound.id,
    contactId: contact.id,
  };
}
