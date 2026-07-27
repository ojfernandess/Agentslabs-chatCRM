import { prisma } from "../../../db.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const logsProvider: McpProvider = {
  domain: "logs",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "logs:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
        ...(params?.errorOnly ? { status: "failed" } : {}),
      },
      take: params?.limit ?? 30,
      orderBy: { startedAt: "desc" },
      select: { id: true, workflowKey: true, status: true, startedAt: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://logs/${e.id}`,
      name: `Execution ${e.id.slice(0, 8)}`,
      description: `${e.workflowKey} — ${e.status}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "logs:read");
    const executionId = uri.replace("opennexo://logs/", "");
    const entries = await prisma.automationExecutionLogEntry.findMany({
      where: { executionId },
      orderBy: { sequence: "asc" },
      include: {
        execution: {
          select: {
            organizationId: true,
            botId: true,
            status: true,
            workflowKey: true,
          },
        },
      },
    });
    if (!entries.length || entries[0]!.execution.organizationId !== ctx.organizationId) {
      throw new Error("Log not found");
    }

    return sanitizeForMcp({
      executionId,
      status: entries[0]!.execution.status,
      workflowKey: entries[0]!.execution.workflowKey,
      entries: entries.map((e) => ({
        sequence: e.sequence,
        level: e.level,
        nodeId: e.nodeId,
        nodeName: e.nodeName,
        nodePath: e.nodePath,
        message: e.message,
        createdAt: e.createdAt,
        ...(ctx.debugMode
          ? { inputContext: e.inputContext, outputContext: e.outputContext, stackTrace: e.stackTrace }
          : {}),
      })),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "logs:search");
    const limit = Math.min(params.limit ?? 50, 200);
    const where = {
      execution: {
        organizationId: ctx.organizationId,
        ...(params.botId ? { botId: params.botId } : {}),
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
        ...(params.from || params.to
          ? {
              startedAt: {
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
              },
            }
          : {}),
      },
      ...(params.errorOnly ? { level: "ERROR" as const } : {}),
      ...(params.query
        ? { message: { contains: params.query, mode: "insensitive" as const } }
        : {}),
    };

    const entries = await prisma.automationExecutionLogEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: params.offset ?? 0,
      select: {
        id: true,
        executionId: true,
        sequence: true,
        level: true,
        nodeId: true,
        nodeName: true,
        message: true,
        createdAt: true,
      },
    });
    return { items: entries, count: entries.length };
  },
};
