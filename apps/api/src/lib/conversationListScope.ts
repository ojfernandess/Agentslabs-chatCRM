import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
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

/** Cópia rasa para aplicar o escopo humano sem mutar o `where` partilhado (ex.: visibilidade do dashboard). */
export function cloneConversationWhere(
  base: Prisma.ConversationWhereInput,
): Prisma.ConversationWhereInput {
  const next: Prisma.ConversationWhereInput = { ...base };
  if (base.AND) next.AND = Array.isArray(base.AND) ? [...base.AND] : [base.AND];
  if (base.OR) next.OR = Array.isArray(base.OR) ? [...base.OR] : [base.OR];
  if (base.NOT) next.NOT = Array.isArray(base.NOT) ? [...base.NOT] : base.NOT;
  return next;
}

/**
 * KPIs de «abertas/pendentes agora» devem usar o mesmo recorte de «Todas as conversas»
 * quando a separação humano/bot está activa — senão a fila do bot infla o painel e o relatório.
 */
export async function applyHumanAttendanceSnapshotIfEnabled(
  organizationId: string,
  where: Prisma.ConversationWhereInput,
  explicitStatus: "OPEN" | "PENDING",
): Promise<void> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { conversationsAllScopeHumanOnly: true },
  });
  if (settings?.conversationsAllScopeHumanOnly !== true) return;
  await applyAllConversationsHumanAttendanceScope(organizationId, where, explicitStatus);
}

/** Estados incluídos na aba «Bot em atendimento». Com separação activa, inclui finalizadas do bot. */
export function botAttendanceStatuses(includeResolvedFromAllScope: boolean): Array<"OPEN" | "PENDING" | "RESOLVED"> {
  return includeResolvedFromAllScope ? ["OPEN", "PENDING", "RESOLVED"] : ["OPEN", "PENDING"];
}

/** Início do dia local do servidor (mesmo critério de dashboard/lembretes). */
export function conversationDayStart(now = new Date()): Date {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart;
}

/**
 * Restringe o contador «Bot em atendimento» a conversas com interação hoje:
 * mensagem inbound do contacto ou resposta registada no orçamento de interações.
 */
export function applyBotInteractionTodayScope(
  where: Prisma.ConversationWhereInput,
  dayStart: Date,
): void {
  appendConversationWhereAnd(where, {
    OR: [
      {
        messages: {
          some: {
            direction: "INBOUND",
            isPrivate: false,
            createdAt: { gte: dayStart },
          },
        },
      },
      {
        interactionBudget: {
          lastInteractionAt: { gte: dayStart },
        },
      },
    ],
  });
}
