import { config } from "../../../config.js";
import { prisma } from "../../../db.js";
import { isLangfuseConfigured, readLangfuseConfig } from "../../agent-engine/observability/LangfuseBridge.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

function langfuseTraceIdFromLogMessage(message: string): string | null {
  try {
    const parsed = JSON.parse(message) as { traceId?: unknown; exported?: unknown };
    if (typeof parsed.traceId === "string" && parsed.exported === true) return parsed.traceId;
  } catch {
    // ignore
  }
  return null;
}

export const observabilityProvider: McpProvider = {
  domain: "observability",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "observability:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://observability/${e.id}`,
      name: `Trace ${e.id.slice(0, 8)}`,
      description: `Execution trace — ${e.status}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "observability:traces");
    const executionId = uri.replace("opennexo://observability/", "");
    const execution = await prisma.automationExecution.findFirst({
      where: { id: executionId, organizationId: ctx.organizationId },
      include: {
        logEntries: { orderBy: { sequence: "asc" } },
        bot: { select: { name: true } },
      },
    });
    if (!execution) throw new Error("Trace not found");

    const spans = execution.logEntries.map((e) => ({
      spanId: e.id,
      name: e.nodeName,
      nodeId: e.nodeId,
      level: e.level,
      message: e.message,
      startedAt: e.createdAt,
      durationMs: null,
    }));

    const toolSpans = execution.logEntries.filter(
      (e) => e.nodeId.startsWith("oc_tool_") || /^Tool:/i.test(e.nodeName),
    );

    const langfuseEntry = execution.logEntries.find((e) => e.nodeId === "langfuse");
    const langfuseTraceId = langfuseEntry
      ? langfuseTraceIdFromLogMessage(langfuseEntry.message)
      : null;

    return sanitizeForMcp({
      executionId,
      botName: execution.bot.name,
      langfuseConfigured: isLangfuseConfigured(),
      langfuseHost: readLangfuseConfig()?.baseUrl ?? "https://cloud.langfuse.com",
      langfuseTraceId,
      trace: {
        id: executionId,
        status: execution.status,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
      },
      spans,
      toolSpans: toolSpans.map((e) => ({
        tool: e.nodeName,
        ok: e.level !== "ERROR",
        message: e.message,
        at: e.createdAt,
      })),
      events: execution.logEntries.filter((e) => e.level === "INFO" || e.level === "WARN"),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "observability:read");
    const executionId = params.executionId?.trim();
    let langfuseTraceId: string | null = null;
    let langfuseExportError: string | null = null;

    if (executionId) {
      const entries = await prisma.automationExecutionLogEntry.findMany({
        where: {
          executionId,
          execution: { organizationId: ctx.organizationId },
          nodeId: "langfuse",
        },
        orderBy: { sequence: "desc" },
        take: 1,
        select: { message: true, level: true },
      });
      const entry = entries[0];
      if (entry) {
        if (entry.level === "WARN") {
          langfuseExportError = entry.message;
        } else {
          langfuseTraceId = langfuseTraceIdFromLogMessage(entry.message);
        }
      }
    }

    return {
      langfuseConfigured: isLangfuseConfigured(),
      langfuseHost: readLangfuseConfig()?.baseUrl ?? "https://cloud.langfuse.com",
      publicUrl: config.publicUrl,
      executionId: executionId ?? null,
      langfuseTraceId,
      langfuseExportError,
    };
  },
};

export const workflowValidatorProvider: McpProvider = {
  domain: "workflow_validator",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "workflow_validator:read");
    const bots = await prisma.bot.findMany({
      where: {
        organizationId: ctx.organizationId,
        automationProfile: { isNot: null },
        ...(params?.botId ? { id: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      select: { id: true, name: true },
    });
    return bots.map((b) => ({
      uri: `opennexo://workflow_validator/${b.id}`,
      name: `Validator ${b.name}`,
      description: "Workflow validation result for agent",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "workflow_validator:read");
    const botId = uri.replace("opennexo://workflow_validator/", "");
    const { validateAgentWorkflow } = await import(
      "../../agent-engine/audit/WorkflowValidator.js"
    );
    const { parseAgentEngineConfig } = await import(
      "../../agent-engine/config/parseAgentEngineConfig.js"
    );
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId, organizationId: ctx.organizationId },
      include: { bot: { select: { name: true } } },
    });
    if (!profile) throw new Error("Agent not found");

    const beh =
      profile.behaviorConfig && typeof profile.behaviorConfig === "object"
        ? (profile.behaviorConfig as Record<string, unknown>)
        : {};
    const engine = parseAgentEngineConfig(beh);

    const result = validateAgentWorkflow({
      userMessage: "",
      replyText: "",
      toolOutcomes: [],
      kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
      strictMode: engine.strictMode,
      supervisorEnabled: engine.supervisorEnabled,
      graphNodeSequence: [
        "classify_intent",
        "load_memory",
        "select_tool",
        "execute_tool",
        "validate_result",
        "supervisor",
        "reply",
      ],
    });

    return sanitizeForMcp({
      botId,
      botName: profile.bot.name,
      mode: "configuration_audit",
      ...result,
    });
  },
};

export const supervisorProvider: McpProvider = {
  domain: "supervisor",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "supervisor:read");
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
      uri: `opennexo://supervisor/${e.id}`,
      name: `Supervisor ${e.id.slice(0, 8)}`,
      description: "Supervisor decisions for execution",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "supervisor:read");
    const executionId = uri.replace("opennexo://supervisor/", "");
    const entries = await prisma.automationExecutionLogEntry.findMany({
      where: {
        executionId,
        OR: [
          { nodeId: { contains: "supervisor" } },
          { nodeName: { contains: "Supervisor", mode: "insensitive" } },
          { message: { contains: "supervisor", mode: "insensitive" } },
        ],
      },
      orderBy: { sequence: "asc" },
      include: {
        execution: { select: { organizationId: true, botId: true, status: true } },
      },
    });
    if (!entries.length || entries[0]!.execution.organizationId !== ctx.organizationId) {
      throw new Error("Supervisor data not found");
    }

    return sanitizeForMcp({
      executionId,
      status: entries[0]!.execution.status,
      decisions: entries.map((e) => ({
        sequence: e.sequence,
        level: e.level,
        message: e.message,
        approved: !/approved\s*[:=]\s*false|"approved"\s*:\s*false/i.test(e.message),
        at: e.createdAt,
        ...(ctx.debugMode ? { outputContext: e.outputContext } : {}),
      })),
      plan: entries.find((e) => /plan/i.test(e.message))?.message ?? null,
      validation: entries.filter((e) => /valid/i.test(e.message)),
      errors: entries.filter((e) => e.level === "ERROR"),
    });
  },
};

export const configProvider: McpProvider = {
  domain: "config",

  async listResources(ctx): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "config:read");
    return [
      {
        uri: `opennexo://config/${ctx.organizationId}`,
        name: "Organization config",
        description: "OpenNexo organization automation settings",
        mimeType: "application/json",
      },
    ];
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "config:read");
    const orgId = uri.replace("opennexo://config/", "");
    if (orgId !== ctx.organizationId) throw new Error("Forbidden");

    const settings = await prisma.automationExecutionLogSettings.findUnique({
      where: { organizationId: orgId },
    });
    const flags = await prisma.organizationFeatureFlag.findMany({
      where: { organizationId: orgId },
      select: { key: true, enabled: true },
    });

    return sanitizeForMcp({
      organizationId: orgId,
      executionLogSettings: settings,
      featureFlags: flags,
      integrations: {
        mem0: Boolean(process.env.MEM0_API_KEY?.trim()),
        langfuse: isLangfuseConfigured(),
        openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
        vectorBackend: "pgvector",
        qdrant: false,
      },
      mcpServerVersion: "1.0.0",
    });
  },
};
