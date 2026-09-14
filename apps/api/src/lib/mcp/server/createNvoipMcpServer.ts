import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuthContext, McpToolResult } from "../types.js";
import { logMcpAudit } from "../audit/McpAuditLogger.js";
import { getMcpProvider } from "../providers/ProviderRegistry.js";

function textResult(data: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

async function withAudit<T>(
  ctx: McpAuthContext,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    void logMcpAudit({ ctx, action, durationMs: Date.now() - started, ok: true });
    return result;
  } catch (err) {
    void logMcpAudit({
      ctx,
      action,
      durationMs: Date.now() - started,
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Servidor MCP dedicado à integração Nvoip (somente leitura/diagnóstico). */
export function createNvoipMcpServer(ctx: McpAuthContext): McpServer {
  const server = new McpServer(
    {
      name: "nvoip-mcp-server",
      version: "1.0.0",
    },
    {
      instructions: `Nvoip MCP — integração de voz, SMS, WhatsApp e PABX (OpenConduit).
Use search_nvoip para consultar conta, saldo, trunks, DIDs, logs, insights, SIP users, WhatsApp e teste de conexão.
Somente leitura/diagnóstico — não altera configuração nem dispara chamadas/mensagens.
Organização: ${ctx.organizationId}. Modo debug: ${ctx.debugMode ? "ativado" : "desativado"}.`,
      capabilities: {
        resources: { subscribe: false, listChanged: false },
        tools: {},
      },
    },
  );

  server.registerResource(
    "nvoip_account",
    "nvoip://account/{organizationId}",
    { description: "Nvoip account summary for the MCP token organization", mimeType: "application/json" },
    async (uri) => {
      const data = await withAudit(ctx, "resource:nvoip_account", () =>
        getMcpProvider("nvoip")!.search!(ctx, { action: "account" }),
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerTool(
    "search_nvoip",
    {
      description:
        "Search Nvoip integration — account, insights, logs, trunks, DIDs, balance, test_connection, whatsapp, sip_users, pabx_trunk",
      inputSchema: {
        action: z
          .enum([
            "account",
            "insights",
            "logs",
            "trunks",
            "dids",
            "balance",
            "test_connection",
            "whatsapp",
            "sip_users",
            "pabx_trunk",
          ])
          .optional()
          .describe("What to fetch (default: account)"),
        periodDays: z.number().int().min(1).max(365).optional().describe("For insights — period in days"),
        level: z.enum(["info", "warn", "error"]).optional().describe("Filter integration logs by level"),
        limit: z.number().int().min(1).max(100).optional().describe("Max log rows"),
      },
    },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_nvoip", () => getMcpProvider("nvoip")!.search!(ctx, args))),
  );

  server.registerTool(
    "list_nvoip_resources",
    {
      description: "List Nvoip MCP resources (account URI)",
      inputSchema: {},
    },
    async () =>
      textResult(await withAudit(ctx, "tool:list_nvoip_resources", () => getMcpProvider("nvoip")!.listResources(ctx))),
  );

  return server;
}
