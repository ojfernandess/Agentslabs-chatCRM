import type { WebSocket } from "ws";
import { config } from "../config.js";
import { recordWorkspaceRealtimeEmit } from "./message-processing-monitor/service.js";
import { scheduleConversationUpdatedBroadcast } from "./workspaceConversationUpdatedDebounce.js";

const OPEN = 1;

type SocketMeta = {
  socket: WebSocket;
  conversationIds: Set<string>;
};

const orgSockets = new Map<string, Map<WebSocket, SocketMeta>>();

function getOrgSocketMap(organizationId: string): Map<WebSocket, SocketMeta> {
  let map = orgSockets.get(organizationId);
  if (!map) {
    map = new Map();
    orgSockets.set(organizationId, map);
  }
  return map;
}

function getOrCreateMeta(organizationId: string, socket: WebSocket): SocketMeta {
  const map = getOrgSocketMap(organizationId);
  let meta = map.get(socket);
  if (!meta) {
    meta = { socket, conversationIds: new Set() };
    map.set(socket, meta);
  }
  return meta;
}

function removeSocket(organizationId: string, socket: WebSocket): void {
  const map = orgSockets.get(organizationId);
  if (!map) return;
  map.delete(socket);
  if (map.size === 0) orgSockets.delete(organizationId);
}

function countOpenSockets(map: Map<WebSocket, SocketMeta>): number {
  let n = 0;
  for (const meta of map.values()) {
    if (meta.socket.readyState === OPEN) n += 1;
  }
  return n;
}

function sendRawToSockets(sockets: Iterable<WebSocket>, payload: unknown, organizationId: string): number {
  const raw = JSON.stringify(payload);
  const eventType =
    typeof payload === "object" && payload !== null && "type" in payload
      ? String((payload as { type: unknown }).type)
      : "unknown";
  let recipients = 0;
  for (const socket of sockets) {
    if (socket.readyState !== OPEN) continue;
    try {
      socket.send(raw);
      recipients += 1;
    } catch {
      /* ignore */
    }
  }
  if (recipients > 0) {
    recordWorkspaceRealtimeEmit(organizationId, eventType, payload, recipients);
  }
  return recipients;
}

function conversationRoomSubscribers(
  organizationId: string,
  conversationId: string,
): WebSocket[] {
  const map = orgSockets.get(organizationId);
  if (!map?.size) return [];
  const targets: WebSocket[] = [];
  for (const meta of map.values()) {
    if (meta.conversationIds.has(conversationId)) {
      targets.push(meta.socket);
    }
  }
  return targets;
}

/** Regista um socket por organização (tenant atual no JWT). */
export function registerWorkspaceSocket(organizationId: string, socket: WebSocket): void {
  getOrCreateMeta(organizationId, socket);
  const cleanup = () => {
    removeSocket(organizationId, socket);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

export function subscribeWorkspaceSocketConversations(
  organizationId: string,
  socket: WebSocket,
  conversationIds: string[],
): void {
  if (!conversationIds.length) return;
  const meta = getOrCreateMeta(organizationId, socket);
  for (const id of conversationIds) {
    const trimmed = id.trim();
    if (trimmed) meta.conversationIds.add(trimmed);
  }
}

export function unsubscribeWorkspaceSocketConversations(
  organizationId: string,
  socket: WebSocket,
  conversationIds?: string[],
): void {
  const meta = orgSockets.get(organizationId)?.get(socket);
  if (!meta) return;
  if (!conversationIds?.length) {
    meta.conversationIds.clear();
    return;
  }
  for (const id of conversationIds) {
    meta.conversationIds.delete(id.trim());
  }
}

export function broadcastToOrganization(organizationId: string, payload: unknown): void {
  const map = orgSockets.get(organizationId);
  if (!map?.size) return;
  const sockets = [...map.values()].map((m) => m.socket);
  sendRawToSockets(sockets, payload, organizationId);
}

/**
 * Fase B4 — eventos de conversa só para sockets subscritos à room.
 * Sem subscritores: fallback org-wide (retrocompat até o cliente subscrever).
 */
export function broadcastToConversation(
  organizationId: string,
  conversationId: string,
  payload: unknown,
): void {
  if (!config.workspaceConversationRoomsEnabled) {
    broadcastToOrganization(organizationId, payload);
    return;
  }

  const subscribers = conversationRoomSubscribers(organizationId, conversationId);
  if (subscribers.length === 0) {
    broadcastToOrganization(organizationId, payload);
    return;
  }
  sendRawToSockets(subscribers, payload, organizationId);
}

export function getOrganizationSocketCount(organizationId: string): number {
  const map = orgSockets.get(organizationId);
  return map ? countOpenSockets(map) : 0;
}

export function getConversationSubscriberCount(
  organizationId: string,
  conversationId: string,
): number {
  return conversationRoomSubscribers(organizationId, conversationId).filter(
    (s) => s.readyState === OPEN,
  ).length;
}

/** Indica que o bot está a processar / a gerar resposta (CRM chat + split-view). */
export function broadcastConversationAgentTyping(
  organizationId: string,
  conversationId: string,
  payload: { typing: boolean; botId: string; botName: string },
): void {
  broadcastToConversation(organizationId, conversationId, {
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

function emitConversationUpdatedNow(
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

/** Notifica clientes conectados para recarregar lista/detalhe da conversa (novas mensagens, status, etc.). */
export function broadcastConversationUpdated(
  organizationId: string,
  conversationId: string,
  extra?: ConversationUpdatedBroadcast,
): void {
  scheduleConversationUpdatedBroadcast(
    organizationId,
    conversationId,
    extra,
    config.workspaceConversationUpdatedDebounceMs,
    emitConversationUpdatedNow,
  );
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

/** Testes — limpa registo de sockets. */
export function getWorkspaceHubStats(): {
  organizations: number;
  sockets: number;
  conversationSubscriptions: number;
} {
  let sockets = 0;
  let conversationSubscriptions = 0;
  for (const map of orgSockets.values()) {
    sockets += map.size;
    for (const meta of map.values()) {
      conversationSubscriptions += meta.conversationIds.size;
    }
  }
  return {
    organizations: orgSockets.size,
    sockets,
    conversationSubscriptions,
  };
}

export function resetWorkspaceHubForTests(): void {
  orgSockets.clear();
}
