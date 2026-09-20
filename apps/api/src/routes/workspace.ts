import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { registerWorkspaceSocket } from "../lib/workspaceHub.js";
import {
  endPresenceSession,
  hasActivePresence,
  isValidPresenceSessionKey,
  notifyPresenceChangedIfNeeded,
  notifyPresenceRestoredIfNeeded,
  touchPresenceSession,
} from "../lib/presenceService.js";
import type { JwtPayload } from "../middleware/auth.js";

type WsQuery = { token?: string; sessionKey?: string };

async function handlePresenceConnect(
  userId: string,
  organizationId: string,
  sessionKey: string,
): Promise<void> {
  const wasPresent = await hasActivePresence(userId, organizationId);
  const touched = await touchPresenceSession({
    userId,
    organizationId,
    sessionKey,
    source: "websocket",
    allowReconnect: true,
  });
  if (touched && !wasPresent) {
    await notifyPresenceRestoredIfNeeded(userId, organizationId);
  }
}

async function handlePresenceHeartbeat(
  userId: string,
  organizationId: string,
  sessionKey: string,
): Promise<void> {
  const wasPresent = await hasActivePresence(userId, organizationId);
  const touched = await touchPresenceSession({
    userId,
    organizationId,
    sessionKey,
    source: "websocket",
    allowReconnect: false,
  });
  if (!touched) return;
  if (!wasPresent) {
    await notifyPresenceRestoredIfNeeded(userId, organizationId);
  }
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    const q = req.query as WsQuery;
    const token = q.token ?? "";
    const sessionKey = (q.sessionKey ?? "").trim();
    if (!token) {
      socket.close(1008, "token required");
      return;
    }
    if (!isValidPresenceSessionKey(sessionKey)) {
      socket.close(1008, "sessionKey required");
      return;
    }
    try {
      const payload = app.jwt.verify<JwtPayload>(token);
      const organizationId = payload.actingOrganizationId ?? payload.organizationId ?? null;
      if (!organizationId) {
        socket.close(1008, "no organization context");
        return;
      }
      const userId = payload.id;
      registerWorkspaceSocket(organizationId, socket);
      void handlePresenceConnect(userId, organizationId, sessionKey);
      socket.send(JSON.stringify({ type: "workspace.connected", organizationId }));

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as {
            type?: string;
            sessionKey?: string;
          };
          const key = (msg.sessionKey ?? sessionKey).trim();
          if (!isValidPresenceSessionKey(key)) return;

          if (msg.type === "presence.heartbeat") {
            void handlePresenceHeartbeat(userId, organizationId, key);
          } else if (msg.type === "presence.session_end") {
            void endPresenceSession(userId, key).then(({ becameOffline, organizationId: orgId }) => {
              if (orgId && becameOffline) {
                void notifyPresenceChangedIfNeeded(userId, orgId, true);
              }
            });
          }
        } catch {
          /* ignore malformed messages */
        }
      });

      socket.on("close", () => {
        void endPresenceSession(userId, sessionKey).then(({ becameOffline, organizationId: orgId }) => {
          if (orgId && becameOffline) {
            void notifyPresenceChangedIfNeeded(userId, orgId, true);
          }
        });
      });
    } catch {
      socket.close(1008, "invalid token");
    }
  });
}
