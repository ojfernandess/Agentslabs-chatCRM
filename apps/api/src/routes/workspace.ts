import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { registerWorkspaceSocket } from "../lib/workspaceHub.js";
import type { JwtPayload } from "../middleware/auth.js";

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    const q = req.query as { token?: string };
    const token = q.token ?? "";
    if (!token) {
      socket.close(1008, "token required");
      return;
    }
    try {
      const payload = app.jwt.verify<JwtPayload>(token);
      const organizationId = payload.actingOrganizationId ?? payload.organizationId ?? null;
      if (!organizationId) {
        socket.close(1008, "no organization context");
        return;
      }
      registerWorkspaceSocket(organizationId, socket);
      socket.send(JSON.stringify({ type: "workspace.connected", organizationId }));
    } catch {
      socket.close(1008, "invalid token");
    }
  });
}
