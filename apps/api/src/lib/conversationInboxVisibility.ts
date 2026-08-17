import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { listEmailInboxIdsHiddenFromConversations } from "./inboxEmailConfig.js";

/**
 * Visibilidade da lista de Conversas (aba organização, sem lixeira).
 * O dashboard deve usar o mesmo filtro para os KPIs baterem com o que o utilizador vê.
 */
export function conversationInboxVisibilityWhere(input: {
  organizationId: string;
  hiddenEmailInboxIds: string[];
  /** `undefined` = admin (todas as caixas). `[]` = agente sem caixas. */
  agentInboxIds?: string[];
  /** Só para agentes: equipas do utilizador (conversas sem equipa continuam visíveis). */
  agentTeamIds?: string[];
}): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {
    organizationId: input.organizationId,
    deletedAt: null,
  };

  const and: Prisma.ConversationWhereInput[] = [];
  if (input.hiddenEmailInboxIds.length > 0) {
    and.push({ NOT: { inboxId: { in: input.hiddenEmailInboxIds } } });
  }

  if (input.agentInboxIds) {
    where.inboxId = input.agentInboxIds.length > 0 ? { in: input.agentInboxIds } : { in: [] };
    const teamIds = input.agentTeamIds ?? [];
    where.OR = [{ teamId: null }, ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : [])];
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export async function loadConversationInboxVisibilityWhere(input: {
  organizationId: string;
  userId: string;
  role: string;
}): Promise<Prisma.ConversationWhereInput> {
  const hiddenEmailInboxIds = await listEmailInboxIdsHiddenFromConversations(input.organizationId);
  if (input.role !== "AGENT") {
    return conversationInboxVisibilityWhere({
      organizationId: input.organizationId,
      hiddenEmailInboxIds,
    });
  }

  const [myInboxes, myTeams] = await Promise.all([
    prisma.inboxMember.findMany({
      where: { userId: input.userId, inbox: { organizationId: input.organizationId } },
      select: { inboxId: true },
    }),
    prisma.teamMember.findMany({
      where: { userId: input.userId, team: { organizationId: input.organizationId } },
      select: { teamId: true },
    }),
  ]);

  return conversationInboxVisibilityWhere({
    organizationId: input.organizationId,
    hiddenEmailInboxIds,
    agentInboxIds: myInboxes.map((x) => x.inboxId),
    agentTeamIds: myTeams.map((x) => x.teamId),
  });
}

