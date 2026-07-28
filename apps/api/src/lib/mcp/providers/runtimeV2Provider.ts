import { prisma } from "../../../db.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

function tryParseJson(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

function extractRuntimeV2FromTrace(messages: string[]): unknown {
  for (const msg of [...messages].reverse()) {
    const parsed = tryParseJson(msg);
    if (parsed && typeof parsed === "object" && "runtimeV2" in (parsed as object)) {
      return (parsed as { runtimeV2: unknown }).runtimeV2;
    }
  }
  return null;
}

export const runtimeV2Provider: McpProvider = {
  domain: "runtime_v2",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "executions:read");
    const rows = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });
    return rows.map((e) => ({
      uri: `opennexo://runtime_v2/${e.id}`,
      name: `Runtime V2 ${e.id.slice(0, 8)}`,
      description: "Execution Contract + Tool Orchestrator snapshot",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "executions:debug");
    const executionId = uri.replace("opennexo://runtime_v2/", "");
    const entries = await prisma.automationExecutionLogEntry.findMany({
      where: {
        executionId,
        OR: [
          { nodeId: "agent_engine_trace" },
          { nodeId: { contains: "runtime_v2" } },
          { message: { contains: "runtimeV2", mode: "insensitive" } },
          { message: { contains: "Runtime V2", mode: "insensitive" } },
        ],
      },
      orderBy: { sequence: "desc" },
      take: 10,
    });

    const messages = entries.map((e) => e.message);
    const snapshot = extractRuntimeV2FromTrace(messages);

    const runtimeLogs = entries.filter(
      (e) => e.nodeId?.includes("runtime_v2") || e.message.includes("Runtime V2"),
    );

    return sanitizeForMcp({
      executionId,
      runtimeV2: snapshot,
      orchestratorLogs: runtimeLogs.map((e) => ({
        at: e.createdAt.toISOString(),
        level: e.level,
        message: e.message,
        output: ctx.debugMode ? e.outputContext : undefined,
      })),
      exposedContracts: [
        "PromptContract",
        "ExecutionContract",
        "ExecutionPlan",
        "ToolOrchestratorDecision",
        "ToolSchedulerDecision",
        "PreExecutionValidation",
        "SmartFallbackDecision",
        "ExecutionConsistency",
        "ContractSupervisorChecks",
        "ExecutionAuditReport",
      ],
    });
  },

  async search(ctx, params: McpProviderSearchParams): Promise<unknown> {
    requirePermission(ctx, "executions:read");
    if (params.executionId) {
      return this.readResource!(ctx, `opennexo://runtime_v2/${params.executionId}`);
    }
    return this.listResources(ctx, params);
  },
};
