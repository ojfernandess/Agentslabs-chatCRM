import type { WebSocket } from "ws";

const OPEN = 1;
const orgSockets = new Map<string, Set<WebSocket>>();

function getSet(organizationId: string): Set<WebSocket> {
  let s = orgSockets.get(organizationId);
  if (!s) {
    s = new Set();
    orgSockets.set(organizationId, s);
  }
  return s;
}

/** Regista um socket por organização (tenant atual no JWT). */
export function registerWorkspaceSocket(organizationId: string, socket: WebSocket): void {
  const set = getSet(organizationId);
  set.add(socket);
  const cleanup = () => {
    set.delete(socket);
    if (set.size === 0) orgSockets.delete(organizationId);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

export function broadcastToOrganization(organizationId: string, payload: unknown): void {
  const set = orgSockets.get(organizationId);
  if (!set?.size) return;
  const raw = JSON.stringify(payload);
  for (const s of set) {
    if (s.readyState === OPEN) {
      try {
        s.send(raw);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Indica que o bot está a processar / a gerar resposta (CRM chat + split-view). */
export function broadcastConversationAgentTyping(
  organizationId: string,
  conversationId: string,
  payload: { typing: boolean; botId: string; botName: string },
): void {
  broadcastToOrganization(organizationId, {
    type: "conversation.agent_typing",
    conversationId,
    typing: payload.typing,
    botId: payload.botId,
    botName: payload.botName,
  });
}

export type ConversationUpdatedBroadcast = {
  awaitingHumanHandoff?: boolean;
  status?: string;
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string } | null;
  teamId?: string | null;
  inboxId?: string;
  agentBotTriageActive?: boolean;
  updatedAt?: string;
};

/** Notifica clientes conectados para recarregar lista/detalhe da conversa (novas mensagens, status, etc.). */
export function broadcastConversationUpdated(
  organizationId: string,
  conversationId: string,
  extra?: ConversationUpdatedBroadcast,
): void {
  broadcastToOrganization(organizationId, {
    type: "conversation.updated",
    conversationId,
    ...extra,
  });
}

/** Sincroniza estado lido/não lido entre abas do mesmo utilizador (badges + sino). */
export function broadcastConversationReadState(
  organizationId: string,
  payload: { conversationId: string; userId: string; read: boolean },
): void {
  broadcastToOrganization(organizationId, {
    type: payload.read ? "conversation.read" : "conversation.unread",
    conversationId: payload.conversationId,
    userId: payload.userId,
  });
}

/** Etiquetas mudaram no contacto — actualiza todas as conversas visíveis desse contacto. */
export function broadcastContactTagsUpdated(
  organizationId: string,
  conversationIds: string[],
): void {
  const seen = new Set<string>();
  for (const conversationId of conversationIds) {
    const id = conversationId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    broadcastConversationUpdated(organizationId, id);
  }
}

export function broadcastUserAvailabilityChanged(
  organizationId: string,
  userId: string,
  status: "online" | "away" | "offline",
): void {
  broadcastToOrganization(organizationId, {
    type: "user.availability_changed",
    userId,
    status,
  });
}

/** Presença efectiva mudou (heartbeat timeout ou reconexão) — não altera intent no banco. */
export function broadcastUserPresenceChanged(
  organizationId: string,
  userId: string,
  presenceConnected: boolean,
  effectiveAvailabilityStatus: "online" | "away" | "offline",
): void {
  broadcastToOrganization(organizationId, {
    type: "user.presence_changed",
    userId,
    presenceConnected,
    effectiveAvailabilityStatus,
  });
}
