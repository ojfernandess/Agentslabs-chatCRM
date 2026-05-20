import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type ConversationUnreadInput = {
  id: string;
  updatedAt: Date;
  teamTransferPulseAt: Date | null;
  /** Última mensagem (geralmente a mais recente na listagem). */
  lastMessage?: { createdAt: Date; direction: string } | null;
};

/**
 * Conversa não lida para o utilizador quando:
 * - nunca abriu (sem estado de leitura), ou
 * - última leitura anterior à última atividade (mensagem ou updatedAt), ou
 * - transferência de equipa ainda não vista (team_transfer_pulse_at).
 */
export function isConversationUnreadForUser(
  conv: ConversationUnreadInput,
  lastReadAt: Date | null | undefined,
): boolean {
  const lastInboundAt =
    conv.lastMessage?.direction === "INBOUND" ? conv.lastMessage.createdAt.getTime() : null;
  const activityMs = Math.max(conv.updatedAt.getTime(), lastInboundAt ?? 0);

  if (lastReadAt == null) return true;
  if (lastReadAt.getTime() < activityMs) return true;
  if (conv.teamTransferPulseAt && lastReadAt.getTime() < conv.teamTransferPulseAt.getTime()) return true;
  return false;
}

/**
 * Conta conversas por equipa com `team_transfer_pulse_at` definido e ainda não «vistas»
 * pelo utilizador (última abertura no painel antes desse pulso).
 */
export async function getUnseenTeamTransferCounts(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  teamIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (teamIds.length === 0) return out;

  const rows = await prisma.$queryRaw<{ team_id: string; c: bigint }[]>(Prisma.sql`
    SELECT c.team_id::text AS team_id, COUNT(*)::bigint AS c
    FROM conversations c
    INNER JOIN team_members tm ON tm.team_id = c.team_id AND tm.user_id = ${userId}::uuid
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.team_id::text IN (${Prisma.join(teamIds)})
      AND c.team_transfer_pulse_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM conversation_user_read_states r
        WHERE r.user_id = ${userId}::uuid
          AND r.conversation_id = c.id
          AND r.last_read_at >= c.team_transfer_pulse_at
      )
    GROUP BY c.team_id
  `);

  for (const row of rows) {
    out.set(row.team_id, Number(row.c));
  }
  return out;
}

/** Marca como não lida: última leitura antes de qualquer atividade recente da conversa. */
export async function markConversationUnreadForUser(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; conversationId: string },
): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, updatedAt: true, teamTransferPulseAt: true },
  });
  if (!conv) return false;

  const lastInbound = await prisma.message.findFirst({
    where: { conversationId: conv.id, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const candidates = [conv.updatedAt.getTime() - 1];
  if (lastInbound) candidates.push(lastInbound.createdAt.getTime() - 1);
  if (conv.teamTransferPulseAt) candidates.push(conv.teamTransferPulseAt.getTime() - 1);
  const markAt = new Date(Math.min(...candidates));

  await prisma.conversationUserReadState.upsert({
    where: {
      userId_conversationId: { userId: input.userId, conversationId: input.conversationId },
    },
    create: { userId: input.userId, conversationId: input.conversationId, lastReadAt: markAt },
    update: { lastReadAt: markAt },
  });
  return true;
}

export async function markConversationReadForUser(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; conversationId: string },
): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!conv) return false;

  const now = new Date();
  await prisma.conversationUserReadState.upsert({
    where: {
      userId_conversationId: { userId: input.userId, conversationId: input.conversationId },
    },
    create: { userId: input.userId, conversationId: input.conversationId, lastReadAt: now },
    update: { lastReadAt: now },
  });
  return true;
}

export async function loadLastReadAtByConversation(
  prisma: PrismaClient,
  userId: string,
  conversationIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (conversationIds.length === 0) return map;
  const rows = await prisma.conversationUserReadState.findMany({
    where: { userId, conversationId: { in: conversationIds } },
    select: { conversationId: true, lastReadAt: true },
  });
  for (const row of rows) {
    map.set(row.conversationId, row.lastReadAt);
  }
  return map;
}

export function withUnreadFlag<T extends ConversationUnreadInput>(
  rows: T[],
  lastReadByConversation: Map<string, Date>,
): Array<T & { isUnread: boolean }> {
  return rows.map((row) => ({
    ...row,
    isUnread: isConversationUnreadForUser(row, lastReadByConversation.get(row.id)),
  }));
}
