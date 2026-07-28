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

type TurnSnapshot = {
  version?: number;
  userMessage?: string;
  intentKind?: string;
  intentConfidence?: number;
  promptHash?: string;
  objective?: string;
  requiredToolNames?: string[];
  pendingToolNames?: string[];
  satisfiedToolNames?: string[];
  forbiddenToolNames?: string[];
  planPhase?: string;
  contractValid?: boolean;
  violations?: string[];
  eilEnabled?: boolean;
};

function extractTurnFromMessages(messages: string[]): TurnSnapshot | null {
  for (const msg of [...messages].reverse()) {
    const parsed = tryParseJson(msg);
    if (!parsed || typeof parsed !== "object") continue;
    const o = parsed as Record<string, unknown>;
    if (o.turn && typeof o.turn === "object") return o.turn as TurnSnapshot;
    if (o.contractValid != null || Array.isArray(o.requiredToolNames)) {
      return o as TurnSnapshot;
    }
  }
  return null;
}

async function loadTurnForExecution(
  organizationId: string,
  executionId: string,
): Promise<{ status: string; turn: TurnSnapshot | null; logHits: unknown[] }> {
  const entries = await prisma.automationExecutionLogEntry.findMany({
    where: {
      executionId,
      OR: [
        { nodeId: "turn_context" },
        { nodeId: "agent_engine_trace" },
        { nodeId: { contains: "agent_engine" } },
        { message: { contains: "contractValid" } },
        { message: { contains: '"turn"' } },
      ],
    },
    orderBy: { sequence: "asc" },
    include: {
      execution: { select: { organizationId: true, status: true } },
    },
  });

  if (!entries.length || entries[0]!.execution.organizationId !== organizationId) {
    throw new Error("Turn data not found for execution");
  }

  const messages = entries.map((e) => e.message);
  const turn = extractTurnFromMessages(messages);

  return {
    status: entries[0]!.execution.status,
    turn,
    logHits: entries.slice(-12).map((e) => ({
      sequence: e.sequence,
      nodeId: e.nodeId,
      nodeName: e.nodeName,
      level: e.level,
      messagePreview: e.message.slice(0, 400),
    })),
  };
}

export const turnProvider: McpProvider = {
  domain: "turn",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "turn:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://turn/${e.id}`,
      name: `Turn ${e.id.slice(0, 8)}`,
      description: "TurnContext snapshot (intent, prompt hash, plan)",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "turn:read");
    const executionId = uri.replace("opennexo://turn/", "");
    const data = await loadTurnForExecution(ctx.organizationId, executionId);
    return sanitizeForMcp({
      executionId,
      status: data.status,
      turn: data.turn
        ? {
            version: data.turn.version,
            userMessage: data.turn.userMessage,
            intent: {
              kind: data.turn.intentKind,
              confidence: data.turn.intentConfidence,
            },
            promptHash: data.turn.promptHash,
            objective: data.turn.objective,
            planPhase: data.turn.planPhase,
            eilEnabled: data.turn.eilEnabled,
            requiredToolNames: data.turn.requiredToolNames ?? [],
            pendingToolNames: data.turn.pendingToolNames ?? [],
          }
        : null,
      logHits: data.logHits,
    });
  },

  async search(ctx, params: McpProviderSearchParams) {
    requirePermission(ctx, "turn:read");
    if (params.executionId) {
      return this.readResource(ctx, `opennexo://turn/${params.executionId}`);
    }
    const resources = await this.listResources(ctx, params);
    return { items: resources, count: resources.length };
  },
};

export const contractProvider: McpProvider = {
  domain: "contract",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "contract:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://contract/${e.id}`,
      name: `Contract ${e.id.slice(0, 8)}`,
      description: "ExecutionContract (required/pending tools, violations)",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "contract:read");
    const executionId = uri.replace("opennexo://contract/", "");
    const data = await loadTurnForExecution(ctx.organizationId, executionId);
    const t = data.turn;
    return sanitizeForMcp({
      executionId,
      status: data.status,
      contract: t
        ? {
            valid: t.contractValid === true,
            planPhase: t.planPhase,
            objective: t.objective,
            requiredToolNames: t.requiredToolNames ?? [],
            pendingToolNames: t.pendingToolNames ?? [],
            satisfiedToolNames: t.satisfiedToolNames ?? [],
            forbiddenToolNames: t.forbiddenToolNames ?? [],
            violations: t.violations ?? [],
            promptHash: t.promptHash,
          }
        : null,
      logHits: data.logHits,
    });
  },

  async search(ctx, params: McpProviderSearchParams) {
    requirePermission(ctx, "contract:read");
    if (params.executionId) {
      return this.readResource(ctx, `opennexo://contract/${params.executionId}`);
    }
    const resources = await this.listResources(ctx, params);
    return { items: resources, count: resources.length };
  },
};
