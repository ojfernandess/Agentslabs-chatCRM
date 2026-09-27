import { MessageReactionSenderType } from "@prisma/client";
import { prisma } from "../db.js";

export type MessageReactionApiRow = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  senderType: "CONTACT" | "AGENT";
  users: { id: string; name: string }[];
};

export const messageReactionInclude = {
  actorUser: { select: { id: true, name: true, displayName: true } },
} as const;

export function contactReactionActorKey(phoneE164: string): string {
  return `contact:${phoneE164}`;
}

export function agentReactionActorKey(userId: string): string {
  return `agent:${userId}`;
}

export function mapMessageReactionsForApi(
  rows: {
    emoji: string;
    senderType: MessageReactionSenderType;
    actorKey: string;
    actorUserId: string | null;
    actorUser: { id: string; name: string; displayName: string | null } | null;
  }[],
  currentUserId?: string,
): MessageReactionApiRow[] {
  const byEmoji = new Map<string, MessageReactionApiRow>();
  for (const row of rows) {
    let bucket = byEmoji.get(row.emoji);
    if (!bucket) {
      bucket = {
        emoji: row.emoji,
        count: 0,
        reactedByMe: false,
        senderType: row.senderType,
        users: [],
      };
      byEmoji.set(row.emoji, bucket);
    }
    bucket.count += 1;
    const name =
      row.actorUser?.displayName?.trim() ||
      row.actorUser?.name ||
      (row.senderType === MessageReactionSenderType.CONTACT ? "Cliente" : "Agente");
    if (row.senderType === MessageReactionSenderType.AGENT && row.actorUserId === currentUserId) {
      bucket.reactedByMe = true;
    }
    if (row.actorUser) {
      bucket.users.push({ id: row.actorUser.id, name });
    } else if (row.senderType === MessageReactionSenderType.CONTACT) {
      bucket.users.push({ id: row.actorKey, name });
    }
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export async function applyContactMessageReaction(params: {
  messageId: string;
  phoneE164: string;
  emoji: string;
}): Promise<void> {
  const actorKey = contactReactionActorKey(params.phoneE164);
  const emoji = params.emoji.trim();
  if (!emoji) {
    await prisma.messageReaction.deleteMany({ where: { messageId: params.messageId, actorKey } });
    return;
  }
  await prisma.messageReaction.upsert({
    where: { messageId_actorKey: { messageId: params.messageId, actorKey } },
    create: {
      messageId: params.messageId,
      actorKey,
      emoji,
      senderType: MessageReactionSenderType.CONTACT,
    },
    update: { emoji },
  });
}

export async function toggleAgentMessageReaction(params: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<"added" | "removed"> {
  const actorKey = agentReactionActorKey(params.userId);
  const emoji = params.emoji.trim();
  if (!emoji) {
    await prisma.messageReaction.deleteMany({ where: { messageId: params.messageId, actorKey } });
    return "removed";
  }

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_actorKey: { messageId: params.messageId, actorKey } },
  });

  if (existing?.emoji === emoji) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
    return "removed";
  }

  await prisma.messageReaction.upsert({
    where: { messageId_actorKey: { messageId: params.messageId, actorKey } },
    create: {
      messageId: params.messageId,
      actorKey,
      emoji,
      senderType: MessageReactionSenderType.AGENT,
      actorUserId: params.userId,
    },
    update: { emoji },
  });
  return "added";
}

export async function loadMessageReactionsForApi(
  messageId: string,
  currentUserId?: string,
): Promise<MessageReactionApiRow[]> {
  const rows = await prisma.messageReaction.findMany({
    where: { messageId },
    include: messageReactionInclude,
  });
  return mapMessageReactionsForApi(rows, currentUserId);
}
