import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { participantPhoneKey } from "./channelInboxIngest.js";

const HIDDEN_VISITOR_BODIES = new Set([
  "Início do atendimento via formulário pré-chat.",
]);

export type WebsiteVisitorMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  sentAt: string;
};

export async function listWebsiteVisitorMessages(params: {
  organizationId: string;
  inboxId: string;
  channelType: InboxChannelType;
  participantId: string;
  afterId?: string | null;
}): Promise<{ conversationId: string | null; messages: WebsiteVisitorMessage[] }> {
  const phone = participantPhoneKey(params.channelType, params.participantId);
  const contact = await prisma.contact.findFirst({
    where: { organizationId: params.organizationId, phone },
    select: { id: true },
  });
  if (!contact) {
    return { conversationId: null, messages: [] };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      organizationId: params.organizationId,
      contactId: contact.id,
      inboxId: params.inboxId,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!conversation) {
    return { conversationId: null, messages: [] };
  }

  let afterSentAt: Date | undefined;
  if (params.afterId) {
    const cursor = await prisma.message.findFirst({
      where: { id: params.afterId, conversationId: conversation.id },
      select: { sentAt: true },
    });
    if (cursor) afterSentAt = cursor.sentAt;
  }

  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      isPrivate: false,
      type: "TEXT",
      body: { not: null },
      ...(afterSentAt ? { sentAt: { gt: afterSentAt } } : {}),
    },
    orderBy: { sentAt: "asc" },
    take: 100,
    select: {
      id: true,
      direction: true,
      body: true,
      sentAt: true,
    },
  });

  const messages: WebsiteVisitorMessage[] = [];
  for (const row of rows) {
    const body = row.body?.trim() ?? "";
    if (!body || HIDDEN_VISITOR_BODIES.has(body)) continue;
    messages.push({
      id: row.id,
      direction: row.direction,
      body,
      sentAt: row.sentAt.toISOString(),
    });
  }

  return { conversationId: conversation.id, messages };
}
