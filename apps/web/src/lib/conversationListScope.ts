export type ConversationListScopeState = {
  botAttendanceActive: boolean;
  attendanceScopeActive: boolean;
  mineActive: boolean;
  statusFilter: string;
  teamFilter: string;
  inboxFilter: string;
  leadTypeFilter: string;
  hideResolvedInAllScope: boolean;
  orgAllScopeHumanOnly: boolean;
  userId?: string;
  userName?: string;
};

export type ConversationScopeRow = {
  id: string;
  status: string;
  assignedTo?: { id: string; name: string } | null;
  assignedToId?: string | null;
  team?: { id: string } | null;
  teamId?: string | null;
  inbox?: { id: string } | null;
  inboxId?: string;
  awaitingHumanHandoff?: boolean;
  agentBotTriageActive?: boolean;
  leadType?: { id: string } | null;
  contact?: {
    pipelineStage?: { leadTypeId: string | null } | null;
  };
};

export type ConversationBellScopeRow = {
  status: string;
  assignedTo?: { id: string; name?: string } | null;
  assignedToId?: string | null;
  awaitingHumanHandoff?: boolean;
  agentBotTriageActive?: boolean;
};

function assignedId(row: ConversationBellScopeRow): string | null {
  return row.assignedToId ?? row.assignedTo?.id ?? null;
}

function isBotQueueRow(row: ConversationBellScopeRow): boolean {
  return (
    (row.status === "OPEN" || row.status === "PENDING") &&
    assignedId(row) == null &&
    !row.awaitingHumanHandoff
  );
}

/** Sino / desktop — espelha API `conversationBellScope` quando separação humano/bot está activa. */
export function conversationSuppressedFromHumanAllBell(
  row: ConversationBellScopeRow,
  conversationsAllScopeHumanOnly: boolean,
): boolean {
  if (!conversationsAllScopeHumanOnly) return false;
  if (!row.agentBotTriageActive) return false;
  if (row.status === "RESOLVED") return true;
  if (row.awaitingHumanHandoff) return false;
  if (assignedId(row) != null) return false;
  return row.status === "OPEN" || row.status === "PENDING";
}

function isBotScopeRow(row: ConversationScopeRow, includeResolvedInBotScope: boolean): boolean {
  if (!row.agentBotTriageActive) return false;
  const statuses = includeResolvedInBotScope ? ["OPEN", "PENDING", "RESOLVED"] : ["OPEN", "PENDING"];
  if (!statuses.includes(row.status)) return false;
  if (assignedId(row) != null) return false;
  if (row.awaitingHumanHandoff) return false;
  return true;
}

/** Espelha os filtros da aba activa (GET /conversations) para patch em tempo real. */
export function conversationMatchesListScope(
  row: ConversationScopeRow,
  scope: ConversationListScopeState,
): boolean {
  const teamId = row.teamId ?? row.team?.id ?? null;
  const inboxId = row.inboxId ?? row.inbox?.id ?? null;
  const leadTypeId = row.leadType?.id ?? row.contact?.pipelineStage?.leadTypeId ?? null;

  if (scope.teamFilter && teamId !== scope.teamFilter) return false;
  if (scope.inboxFilter && inboxId !== scope.inboxFilter) return false;
  if (scope.leadTypeFilter && leadTypeId !== scope.leadTypeFilter) return false;

  if (scope.botAttendanceActive) {
    return isBotScopeRow(row, scope.orgAllScopeHumanOnly);
  }

  if (scope.attendanceScopeActive && !scope.mineActive) {
    return row.status === "OPEN" && assignedId(row) == null;
  }

  if (scope.mineActive) {
    if (scope.statusFilter && row.status !== scope.statusFilter) return false;
    return assignedId(row) === scope.userId;
  }

  if (scope.statusFilter) {
    if (row.status !== scope.statusFilter) return false;
  } else if (scope.hideResolvedInAllScope && row.status === "RESOLVED") {
    return false;
  }

  if (scope.hideResolvedInAllScope && row.agentBotTriageActive && isBotQueueRow(row)) {
    return false;
  }

  return true;
}

export function mergeConversationScopeHint<T extends ConversationScopeRow>(
  row: T,
  hint?: Partial<ConversationScopeRow> | null,
  options?: { currentUserId?: string; currentUserName?: string },
): T {
  if (!hint) return row;
  const assignedToId =
    hint.assignedToId !== undefined ? hint.assignedToId : (row.assignedToId ?? row.assignedTo?.id ?? null);

  const resolveAssigneeName = (id: string): string | null => {
    if (row.assignedTo?.id === id && row.assignedTo.name?.trim()) {
      return row.assignedTo.name.trim();
    }
    if (options?.currentUserId === id && options.currentUserName?.trim()) {
      return options.currentUserName.trim();
    }
    return null;
  };

  let assignedTo = row.assignedTo;
  if (hint.assignedTo !== undefined) {
    if (hint.assignedTo === null) {
      // WS estrutural costuma omitir o nome — só limpar quando a atribuição foi removida.
      if (assignedToId == null) {
        assignedTo = null;
      } else {
        const resolvedName = resolveAssigneeName(assignedToId);
        assignedTo = resolvedName
          ? { id: assignedToId, name: resolvedName }
          : row.assignedTo?.id === assignedToId
            ? row.assignedTo
            : { id: assignedToId, name: "" };
      }
    } else {
      const hintedName = hint.assignedTo.name?.trim();
      assignedTo =
        hintedName || !assignedToId
          ? hint.assignedTo
          : (() => {
              const resolvedName = resolveAssigneeName(assignedToId);
              return resolvedName ? { id: assignedToId, name: resolvedName } : hint.assignedTo;
            })();
    }
  } else if (hint.assignedToId !== undefined) {
    if (!assignedToId) {
      assignedTo = null;
    } else {
      const resolvedName = resolveAssigneeName(assignedToId);
      if (resolvedName) {
        assignedTo = { id: assignedToId, name: resolvedName };
      } else if (row.assignedTo?.id === assignedToId) {
        assignedTo = row.assignedTo;
      } else {
        assignedTo = { id: assignedToId, name: "" };
      }
    }
  }

  return {
    ...row,
    status: hint.status ?? row.status,
    assignedToId,
    teamId: hint.teamId !== undefined ? hint.teamId : (row.teamId ?? row.team?.id ?? null),
    inboxId: hint.inboxId ?? row.inboxId ?? row.inbox?.id,
    awaitingHumanHandoff: hint.awaitingHumanHandoff ?? row.awaitingHumanHandoff,
    agentBotTriageActive: hint.agentBotTriageActive ?? row.agentBotTriageActive,
    assignedTo,
  };
}
