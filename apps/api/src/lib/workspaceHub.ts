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

/** Notifica clientes conectados para recarregar lista/detalhe da conversa (novas mensagens, status, etc.). */
export function broadcastConversationUpdated(
  organizationId: string,
  conversationId: string,
  extra?: { awaitingHumanHandoff?: boolean },
): void {
  broadcastToOrganization(organizationId, {
    type: "conversation.updated",
    conversationId,
    ...extra,
  });
}
