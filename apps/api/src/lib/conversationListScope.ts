import type { Prisma } from "@prisma/client";
import { listInboxIdsWithAgentBotTriage } from "./agentBotTriage.js";

export function appendConversationWhereAnd(
  where: Prisma.ConversationWhereInput,
  clause: Prisma.ConversationWhereInput,
): void {
  const existing = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
  where.AND = [...existing, clause];
}

export function isOrgAllConversationsListScope(input: {
  botAttendance: boolean;
  waitingAttendance: boolean;
  activeAttendance: boolean;
  mineRequested: boolean;
}): boolean {
  return (
    !input.botAttendance &&
    !(input.waitingAttendance && !input.mineRequested) &&
    !(input.activeAttendance && !input.mineRequested) &&
    !input.mineRequested
  );
}

/**
 * Restringe «Todas as conversas» a atendimento humano: exclui RESOLVED e fila do bot.
 * Conversas RESOLVED em caixas de triagem do bot aparecem na aba Bot (ver botAttendanceStatuses).
 * Retorna false quando o pedido pede explicitamente RESOLVED (lista vazia).
 */
export async function applyAllConversationsHumanAttendanceScope(
  organizationId: string,
  where: Prisma.ConversationWhereInput,
  explicitStatus?: "OPEN" | "PENDING" | "RESOLVED",
): Promise<boolean> {
  if (explicitStatus === "RESOLVED") return false;

  if (!explicitStatus) {
    appendConversationWhereAnd(where, { status: { not: "RESOLVED" } });
  }

  const triageInboxIds = await listInboxIdsWithAgentBotTriage(organizationId);
  if (triageInboxIds.length === 0) return true;

  appendConversationWhereAnd(where, {
    NOT: {
      inboxId: { in: triageInboxIds },
      status: { in: ["OPEN", "PENDING"] },
      assignedToId: null,
      awaitingHumanHandoff: false,
    },
  });

  return true;
}

/** Estados incluídos na aba «Bot em atendimento». Com separação activa, inclui finalizadas do bot. */
export function botAttendanceStatuses(includeResolvedFromAllScope: boolean): Array<"OPEN" | "PENDING" | "RESOLVED"> {
  return includeResolvedFromAllScope ? ["OPEN", "PENDING", "RESOLVED"] : ["OPEN", "PENDING"];
}
