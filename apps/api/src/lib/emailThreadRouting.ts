import type { Conversation } from "@prisma/client";
import { prisma } from "../db.js";

export function normalizeEmailMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, "").trim() || null;
}

export function collectEmailThreadMessageIds(
  inReplyTo?: string | string[] | null,
  references?: string | string[] | null,
): string[] {
  const ids = new Set<string>();
  const add = (value: string | string[] | null | undefined) => {
    if (!value) return;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (typeof item !== "string") continue;
      for (const part of item.split(/\s+/)) {
        const norm = normalizeEmailMessageId(part);
        if (norm) ids.add(norm);
      }
    }
  };
  add(inReplyTo);
  add(references);
  return [...ids];
}

function providerMsgIdVariants(id: string): string[] {
  const base = normalizeEmailMessageId(id);
  if (!base) return [];
  return [base, `<${base}>`];
}

/** Encontra conversa existente via In-Reply-To / References → providerMsgId. */
export async function findConversationByEmailThreadHeaders(params: {
  organizationId: string;
  inboxId: string;
  messageIds: string[];
}): Promise<Conversation | null> {
  const { organizationId, inboxId, messageIds } = params;
  if (messageIds.length === 0) return null;

  const orConditions = messageIds.flatMap((id) =>
    providerMsgIdVariants(id).map((providerMsgId) => ({ providerMsgId })),
  );

  const match = await prisma.message.findFirst({
    where: {
      OR: orConditions,
      conversation: { organizationId, inboxId },
    },
    orderBy: { createdAt: "desc" },
    select: { conversation: true },
  });

  return match?.conversation ?? null;
}

export async function buildEmailOutboundThreadHeaders(conversationId: string): Promise<{
  inReplyTo?: string;
  references?: string;
}> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      isPrivate: false,
      providerMsgId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { providerMsgId: true },
    take: 30,
  });

  const ids = messages
    .map((m) => m.providerMsgId)
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => {
      const norm = normalizeEmailMessageId(id);
      return norm ? `<${norm}>` : id.trim();
    });

  if (ids.length === 0) return {};
  const inReplyTo = ids[ids.length - 1];
  return { inReplyTo, references: ids.join(" ") };
}
