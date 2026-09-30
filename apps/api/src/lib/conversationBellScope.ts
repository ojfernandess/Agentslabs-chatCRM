/** Linha mínima para espelhar «Todas as conversas» com separação humano/bot (notificações). */
export type ConversationBellScopeRow = {
  status: string;
  assignedToId?: string | null;
  awaitingHumanHandoff?: boolean;
  agentBotTriageActive?: boolean;
};

/**
 * Conversas que ficam na aba «Bot em atendimento» (ou RESOLVED do bot) — não devem
 * alimentar o sino quando `conversationsAllScopeHumanOnly` está activo.
 * Handoff (`awaitingHumanHandoff`) continua a notificar.
 */
export function conversationSuppressedFromBellUnderHumanAllScope(
  row: ConversationBellScopeRow,
  conversationsAllScopeHumanOnly: boolean,
): boolean {
  if (!conversationsAllScopeHumanOnly) return false;
  if (!row.agentBotTriageActive) return false;
  if (row.status === "RESOLVED") return true;
  if (row.awaitingHumanHandoff) return false;
  const unassigned = row.assignedToId == null;
  if (unassigned && (row.status === "OPEN" || row.status === "PENDING")) return true;
  return false;
}

export function resolveConversationBellNotify(input: {
  conversationsAllScopeHumanOnly: boolean;
  agentBotTriageActive: boolean;
  status: string;
  assignedToId?: string | null;
  awaitingHumanHandoff?: boolean;
}): boolean {
  return !conversationSuppressedFromBellUnderHumanAllScope(
    {
      status: input.status,
      assignedToId: input.assignedToId,
      awaitingHumanHandoff: input.awaitingHumanHandoff,
      agentBotTriageActive: input.agentBotTriageActive,
    },
    input.conversationsAllScopeHumanOnly,
  );
}
