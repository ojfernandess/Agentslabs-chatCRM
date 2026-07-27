import { prisma } from "../../../db.js";
import { parseAgentEngineConfig } from "../../agent-engine/config/parseAgentEngineConfig.js";
import { buildExecutionInspectorView } from "../../agent-engine/observability/buildExecutionInspector.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const executionsProvider: McpProvider = {
  domain: "executions",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "executions:read");
    const rows = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
        ...(params?.conversationId ? { conversationId: params.conversationId } : {}),
      },
      take: params?.limit ?? 30,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, workflowKey: true, startedAt: true },
    });
    return rows.map((e) => ({
      uri: `opennexo://executions/${e.id}`,
      name: `Execution ${e.id.slice(0, 8)}`,
      description: `${e.workflowKey} — ${e.status}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, ctx.debugMode ? "executions:debug" : "executions:read");
    const id = uri.replace("opennexo://executions/", "");
    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        logEntries: { orderBy: { sequence: "asc" } },
        bot: { select: { id: true, name: true } },
        conversation: { select: { id: true } },
      },
    });
    if (!execution) throw new Error("Execution not found");

    let triggerMessageBody: string | null = null;
    if (execution.triggerMessageId) {
      const msg = await prisma.message.findUnique({
        where: { id: execution.triggerMessageId },
        select: { body: true },
      });
      triggerMessageBody = msg?.body ?? null;
    }

    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: execution.botId },
      select: { behaviorConfig: true, llmConfig: true },
    });
    const engine = parseAgentEngineConfig(profile?.behaviorConfig);
    const llm =
      profile?.llmConfig && typeof profile.llmConfig === "object"
        ? (profile.llmConfig as Record<string, unknown>)
        : {};

    const inspector = buildExecutionInspectorView({
      executionId: execution.id,
      workflowKey: execution.workflowKey,
      status: execution.status,
      botName: execution.bot.name,
      conversationId: execution.conversationId,
      engine,
      model: typeof llm.model === "string" ? llm.model : null,
      provider: typeof llm.provider === "string" ? llm.provider : null,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      triggerMessageBody,
      triggerMessageId: execution.triggerMessageId,
      logEntries: execution.logEntries.map((e) => ({
        nodeId: e.nodeId,
        nodeName: e.nodeName,
        level: e.level,
        message: e.message,
        sequence: e.sequence,
        createdAt: e.createdAt.toISOString(),
        inputContext: ctx.debugMode ? e.inputContext : undefined,
        outputContext: ctx.debugMode ? e.outputContext : undefined,
        nodePath: e.nodePath,
      })),
    });

    return sanitizeForMcp({
      ...inspector,
      errorMessage: execution.errorMessage,
      durationMs:
        execution.finishedAt && execution.startedAt
          ? execution.finishedAt.getTime() - execution.startedAt.getTime()
          : null,
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "executions:read");
    const items = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params.botId ? { botId: params.botId } : {}),
        ...(params.errorOnly ? { status: "failed" } : {}),
        ...(params.from || params.to
          ? {
              startedAt: {
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
              },
            }
          : {}),
      },
      take: params.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        botId: true,
        conversationId: true,
        status: true,
        workflowKey: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return { items };
  },
};
