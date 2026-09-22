import type { TimelinePayload } from "@/lib/contactTimeline";

export type ConversationTransferredPayload = {
  contact?: { name?: string | null } | null;
  teamId?: string | null;
  teamName?: string | null;
  previousTeamId?: string | null;
  assignedToId?: string | null;
  previousAssignedToId?: string | null;
  handoffSource?: string | null;
  botName?: string | null;
};

export type TransferNotificationMode = "team" | "agent" | "bot" | "humanEscalation" | "fallback";

export type TransferNotificationContent = {
  mode: TransferNotificationMode;
  contactName: string | null;
  teamName: string | null;
  agentName: string | null;
  botName: string | null;
  previousTeamName: string | null;
  actorName: string | null;
};

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function teamChanged(payload: ConversationTransferredPayload): boolean {
  const prev = payload.previousTeamId ?? null;
  const next = payload.teamId ?? null;
  return prev !== next;
}

function assigneeChanged(payload: ConversationTransferredPayload): boolean {
  const prev = payload.previousAssignedToId ?? null;
  const next = payload.assignedToId ?? null;
  return prev !== next;
}

/** Resolve toast copy from the realtime WebSocket payload (no backend changes). */
export function resolveTransferNotificationFromWs(
  payload: ConversationTransferredPayload,
): TransferNotificationContent {
  const contactName = cleanName(payload.contact?.name);
  const teamName = cleanName(payload.teamName);
  const teamMoved = teamChanged(payload);
  const assigneeMoved = assigneeChanged(payload);
  const assignedToId = payload.assignedToId ?? null;
  const previousAssignedToId = payload.previousAssignedToId ?? null;
  const botName = cleanName(payload.botName);

  if (payload.handoffSource === "call_human") {
    return {
      mode: "humanEscalation",
      contactName,
      teamName: teamMoved ? teamName : null,
      agentName: null,
      botName,
      previousTeamName: null,
      actorName: botName,
    };
  }

  if (teamMoved && teamName) {
    return {
      mode: "team",
      contactName,
      teamName,
      agentName: null,
      botName: null,
      previousTeamName: null,
      actorName: null,
    };
  }

  if (assigneeMoved && assignedToId === null && previousAssignedToId !== null) {
    return {
      mode: "bot",
      contactName,
      teamName: null,
      agentName: null,
      botName: null,
      previousTeamName: null,
      actorName: null,
    };
  }

  if (assigneeMoved && assignedToId !== null) {
    return {
      mode: "fallback",
      contactName,
      teamName: null,
      agentName: null,
      botName: null,
      previousTeamName: null,
      actorName: null,
    };
  }

  return {
    mode: "fallback",
    contactName,
    teamName: null,
    agentName: null,
    botName: null,
    previousTeamName: null,
    actorName: null,
  };
}

/** Resolve inline system-event copy from persisted timeline payload (richer fields). */
export function resolveTransferNotificationFromTimeline(
  payload: TimelinePayload,
  contactName: string | null,
  actorName: string | null,
): TransferNotificationContent {
  const newTeamName = cleanName(payload.newTeamName);
  const previousTeamName = cleanName(payload.previousTeamName);
  const newAssigneeName = cleanName(payload.newAssigneeName);
  const newAssigneeId =
    typeof payload.newAssigneeId === "string" ? payload.newAssigneeId : null;
  const previousAssigneeId =
    typeof payload.previousAssigneeId === "string" ? payload.previousAssigneeId : null;
  const botNameFromPayload = cleanName(payload.botName);

  const teamMoved = previousTeamName !== newTeamName && Boolean(previousTeamName || newTeamName);

  if (payload.handoffSource === "call_human") {
    return {
      mode: "humanEscalation",
      contactName,
      teamName: newTeamName,
      agentName: null,
      botName: botNameFromPayload,
      previousTeamName,
      actorName: actorName ?? botNameFromPayload,
    };
  }

  if (newTeamName && teamMoved) {
    return {
      mode: "team",
      contactName,
      teamName: newTeamName,
      agentName: null,
      botName: null,
      previousTeamName,
      actorName,
    };
  }

  if (newAssigneeId === null && previousAssigneeId !== null) {
    return {
      mode: "bot",
      contactName,
      teamName: newTeamName,
      agentName: null,
      botName: null,
      previousTeamName,
      actorName,
    };
  }

  if (newAssigneeName) {
    return {
      mode: "agent",
      contactName,
      teamName: newTeamName,
      agentName: newAssigneeName,
      botName: null,
      previousTeamName,
      actorName,
    };
  }

  if (previousTeamName || newTeamName) {
    return {
      mode: "fallback",
      contactName,
      teamName: newTeamName,
      agentName: null,
      botName: null,
      previousTeamName,
      actorName,
    };
  }

  return {
    mode: "fallback",
    contactName,
    teamName: null,
    agentName: null,
    botName: null,
    previousTeamName: null,
    actorName,
  };
}

export function replaceTransferTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return Object.entries(tokens).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );
}
