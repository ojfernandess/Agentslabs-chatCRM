import type { PrismaClient } from "@prisma/client";
import {
  isConversationUnreadForUser,
  loadLastReadAtByConversation,
} from "./teamTransferUnread.js";

export type InboxUnreadCountRow = {
  unread: number;
  unreadReceived: number;
};

export async function getEmailInboxUnreadCounts(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  inboxIds: string[],
): Promise<Record<string, InboxUnreadCountRow>> {
  const out: Record<string, InboxUnreadCountRow> = {};
  if (inboxIds.length === 0) return out;
  for (const id of inboxIds) out[id] = { unread: 0, unreadReceived: 0 };

  const conversations = await prisma.conversation.findMany({
    where: {
      organizationId,
      inboxId: { in: inboxIds },
      deletedAt: null,
    },
    select: {
      id: true,
      inboxId: true,
      updatedAt: true,
      teamTransferPulseAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, direction: true },
      },
    },
  });

  const readStates = await loadLastReadAtByConversation(
    prisma,
    userId,
    conversations.map((c) => c.id),
  );

  for (const conv of conversations) {
    const lastMessage = conv.messages[0] ?? null;
    const isUnread = isConversationUnreadForUser(
      {
        id: conv.id,
        updatedAt: conv.updatedAt,
        teamTransferPulseAt: conv.teamTransferPulseAt,
        lastMessage,
      },
      readStates.get(conv.id),
    );
    if (!isUnread) continue;
    const bucket = out[conv.inboxId];
    if (!bucket) continue;
    bucket.unread += 1;
    if (lastMessage?.direction === "INBOUND") bucket.unreadReceived += 1;
  }

  return out;
}
