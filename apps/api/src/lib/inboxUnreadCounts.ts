import type { PrismaClient } from "@prisma/client";
import {
  isConversationUnreadForUser,
  loadLastReadAtByConversation,
} from "./teamTransferUnread.js";

/** Conta apenas conversas não lidas cuja última mensagem é recebida (INBOUND). */
export async function getEmailInboxUnreadCounts(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  inboxIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (inboxIds.length === 0) return out;
  for (const id of inboxIds) out[id] = 0;

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
    if (lastMessage?.direction !== "INBOUND") continue;
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
    out[conv.inboxId] = (out[conv.inboxId] ?? 0) + 1;
  }

  return out;
}
