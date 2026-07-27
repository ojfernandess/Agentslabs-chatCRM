import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpAuthContext } from "../types.js";
import { createOpenNexoMcpServer } from "../server/createMcpServer.js";

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  auth: McpAuthContext;
  createdAt: number;
};

const sessions = new Map<string, SessionEntry>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      void entry.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: McpAuthContext,
  parsedBody?: unknown,
): Promise<void> {
  cleanupStaleSessions();

  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;

  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    if (entry.auth.organizationId !== auth.organizationId) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "Session organization mismatch" }));
      return;
    }
    await entry.transport.handleRequest(req, res, parsedBody);
    return;
  }

  if (!sessionId && parsedBody && isInitializeRequest(parsedBody)) {
    let activeSessionId: string | undefined;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        activeSessionId = sid;
        sessions.set(sid, {
          transport,
          auth,
          createdAt: Date.now(),
        });
      },
    });

    transport.onclose = () => {
      if (activeSessionId) {
        sessions.delete(activeSessionId);
      }
    };

    const server = createOpenNexoMcpServer(auth);
    await server.connect(transport);

    await transport.handleRequest(req, res, parsedBody);
    return;
  }

  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: valid MCP session ID or initialize request required" },
      id: null,
    }),
  );
}

export function getActiveMcpSessionCount(): number {
  return sessions.size;
}

export async function closeAllMcpSessions(): Promise<void> {
  for (const [id, entry] of sessions) {
    await entry.transport.close().catch(() => {});
    sessions.delete(id);
  }
}
