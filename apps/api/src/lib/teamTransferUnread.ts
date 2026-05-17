import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

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

/** Marca como não lida para o utilizador (última leitura antes da última atividade). */
export async function markConversationUnreadForUser(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; conversationId: string },
): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, updatedAt: true },
  });
  if (!conv) return false;

  const markAt = new Date(conv.updatedAt.getTime() - 60_000);
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
