import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuthContext, McpToolResult } from "../types.js";
import { logMcpAudit } from "../audit/McpAuditLogger.js";
import { getMcpProvider, listAllMcpResources, readMcpResourceByUri } from "../providers/ProviderRegistry.js";
import { getAgentPromptAssembly } from "../providers/promptsProvider.js";
import { getAgentKnowledgeConfig } from "../providers/knowledgeProvider.js";
import { listMcpAuditLogs } from "../audit/McpAuditLogger.js";

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
  resourceType?: string,
  resourceId?: string,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    void logMcpAudit({
      ctx,
      action,
      resourceType,
      resourceId,
      durationMs: Date.now() - started,
      ok: true,
    });
    return result;
  } catch (err) {
    void logMcpAudit({
      ctx,
      action,
      resourceType,
      resourceId,
      durationMs: Date.now() - started,
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Cria instância McpServer com ferramentas e recursos do OpenNexo. */
export function createOpenNexoMcpServer(ctx: McpAuthContext): McpServer {
  const server = new McpServer(
    {
      name: "opennexo-mcp-server",
      version: "1.0.0",
    },
    {
      instructions: `OpenNexo MCP Server — plataforma de agentes (SUPER ADMIN ONLY).
Use as ferramentas de busca para investigar agentes, execuções, prompts, ferramentas, logs, memória, RAG, workflows LangGraph, traces Langfuse e decisões do Supervisor.
Acesso restrito a super administradores da plataforma. Modo debug: ${ctx.debugMode ? "ativado" : "desativado"}.`,
      capabilities: {
        resources: { subscribe: false, listChanged: false },
        tools: {},
      },
    },
  );

  // --- MCP Resources (templates) ---
  server.registerResource(
    "agents",
    "opennexo://agents/{botId}",
    { description: "Agent profile and configuration", mimeType: "application/json" },
    async (uri) => {
      const data = await withAudit(ctx, "resource:read", () => readMcpResourceByUri(ctx, uri.href), "agents", uri.href);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerResource(
    "executions",
    "opennexo://executions/{executionId}",
    { description: "Agent execution inspector", mimeType: "application/json" },
    async (uri) => {
      const data = await withAudit(ctx, "resource:read", () => readMcpResourceByUri(ctx, uri.href), "executions", uri.href);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // --- MCP Tools ---
  const searchSchema = {
    query: z.string().optional().describe("Search query"),
    botId: z.string().uuid().optional().describe("Filter by agent/bot ID"),
    executionId: z.string().uuid().optional().describe("Filter by execution ID"),
    conversationId: z.string().uuid().optional().describe("Filter by conversation ID"),
    contactId: z.string().uuid().optional().describe("Filter by contact ID"),
    toolId: z.string().uuid().optional().describe("Filter by tool ID"),
    errorOnly: z.boolean().optional().describe("Only errors/failures"),
    from: z.string().optional().describe("ISO date from"),
    to: z.string().optional().describe("ISO date to"),
    limit: z.number().int().min(1).max(200).optional().describe("Max results"),
    offset: z.number().int().min(0).optional().describe("Pagination offset"),
  };

  server.registerTool(
    "search_agent",
    { description: "Search agents/bots in the organization", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_agent", () => getMcpProvider("agents")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_tool",
    { description: "Search automation tools", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_tool", () => getMcpProvider("tools")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_prompt",
    { description: "Search prompt modules", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_prompt", () => getMcpProvider("prompts")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_execution",
    { description: "Search agent executions", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_execution", () => getMcpProvider("executions")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_error",
    {
      description: "Search errors in execution logs",
      inputSchema: { ...searchSchema, errorOnly: z.boolean().optional().default(true) },
    },
    async (args) =>
      textResult(
        await withAudit(ctx, "tool:search_error", () =>
          getMcpProvider("logs")!.search!(ctx, { ...args, errorOnly: true }),
        ),
      ),
  );

  server.registerTool(
    "search_logs",
    { description: "Search execution log entries", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_logs", () => getMcpProvider("logs")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_memory",
    { description: "Search conversation memory contexts", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_memory", () => getMcpProvider("memory")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_document",
    { description: "Search knowledge base documents", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_document", () => getMcpProvider("knowledge")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_trace",
    { description: "Find Langfuse/observability trace for an execution", inputSchema: searchSchema },
    async (args) =>
      textResult(await withAudit(ctx, "tool:search_trace", () => getMcpProvider("observability")!.search!(ctx, args))),
  );

  server.registerTool(
    "search_workflow",
    {
      description: "Get workflow graph for an agent",
      inputSchema: { botId: z.string().uuid().describe("Agent/bot ID") },
    },
    async ({ botId }) =>
      textResult(
        await withAudit(ctx, "tool:search_workflow", () =>
          getMcpProvider("workflow")!.readResource(ctx, `opennexo://workflow/${botId}`),
        ),
      ),
  );

  server.registerTool(
    "search_supervisor",
    {
      description: "Get supervisor decisions for an execution",
      inputSchema: { executionId: z.string().uuid().describe("Execution ID") },
    },
    async ({ executionId }) =>
      textResult(
        await withAudit(ctx, "tool:search_supervisor", () =>
          getMcpProvider("supervisor")!.readResource(ctx, `opennexo://supervisor/${executionId}`),
        ),
      ),
  );

  server.registerTool(
    "search_metrics",
    {
      description: "Get tool execution metrics (slowest tools, error rates)",
      inputSchema: { botId: z.string().uuid().optional(), limit: z.number().int().optional() },
    },
    async (args) =>
      textResult(
        await withAudit(ctx, "tool:search_metrics", async () => {
          const tools = await getMcpProvider("tools")!.search!(ctx, args);
          return { tools, note: "Use search_tool with botId for per-tool avgDurationMs" };
        }),
      ),
  );

  server.registerTool(
    "search_config",
    { description: "Get organization automation configuration", inputSchema: {} },
    async () =>
      textResult(
        await withAudit(ctx, "tool:search_config", () =>
          getMcpProvider("config")!.readResource(ctx, `opennexo://config/${ctx.organizationId}`),
        ),
      ),
  );

  server.registerTool(
    "search_integrations",
    { description: "List enabled integrations (Mem0, Langfuse, vector backend)", inputSchema: {} },
    async () =>
      textResult(
        await withAudit(ctx, "tool:search_integrations", () =>
          getMcpProvider("config")!.readResource(ctx, `opennexo://config/${ctx.organizationId}`),
        ),
      ),
  );

  server.registerTool(
    "get_agent_prompt",
    {
      description: "Get assembled prompt for an agent (full prompt in debug mode)",
      inputSchema: { botId: z.string().uuid() },
    },
    async ({ botId }) =>
      textResult(await withAudit(ctx, "tool:get_agent_prompt", () => getAgentPromptAssembly(ctx, botId))),
  );

  server.registerTool(
    "get_execution_inspector",
    {
      description: "Full execution inspector — tools, supervisor, tokens, timeline",
      inputSchema: { executionId: z.string().uuid() },
    },
    async ({ executionId }) =>
      textResult(
        await withAudit(ctx, "tool:get_execution_inspector", () =>
          getMcpProvider("executions")!.readResource(ctx, `opennexo://executions/${executionId}`),
        ),
      ),
  );

  server.registerTool(
    "list_resources",
    {
      description: "List all available MCP resources for this organization",
      inputSchema: { limit: z.number().int().optional() },
    },
    async (args) =>
      textResult(await withAudit(ctx, "tool:list_resources", () => listAllMcpResources(ctx, args))),
  );

  if (ctx.permissions.has("audit:read")) {
    server.registerTool(
      "list_mcp_audit",
      {
        description: "List MCP access audit log entries",
        inputSchema: { limit: z.number().int().optional(), offset: z.number().int().optional() },
      },
      async (args) =>
        textResult(
          await withAudit(ctx, "tool:list_mcp_audit", () =>
            listMcpAuditLogs(ctx.organizationId, args),
          ),
        ),
    );
  }

  return server;
}
