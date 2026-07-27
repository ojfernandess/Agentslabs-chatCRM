import { prisma } from "../../../db.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const toolsProvider: McpProvider = {
  domain: "tools",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "tools:read");
    const tools = await prisma.automationCustomTool.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 50,
      orderBy: { name: "asc" },
      select: { id: true, name: true, toolType: true },
    });
    return tools.map((t) => ({
      uri: `opennexo://tools/${t.id}`,
      name: t.name,
      description: `Tool ${t.name} (${t.toolType})`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "tools:read");
    const id = uri.replace("opennexo://tools/", "");
    const tool = await prisma.automationCustomTool.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!tool) throw new Error("Tool not found");

    const recentExecutions = await prisma.automationToolExecution.findMany({
      where: { toolId: id, organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: ctx.debugMode ? 20 : 5,
      select: {
        id: true,
        ok: true,
        statusCode: true,
        durationMs: true,
        errorMessage: true,
        source: true,
        createdAt: true,
        ...(ctx.debugMode
          ? { requestSummary: true, responseSummary: true }
          : {}),
      },
    });

    return sanitizeForMcp({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      toolType: tool.toolType,
      botId: tool.botId,
      isActive: tool.isActive,
      parametersSchema: tool.parametersSchema,
      config: tool.config,
      stats: {
        executionCount: tool.executionCount,
        avgDurationMs: tool.avgDurationMs,
        lastExecutedAt: tool.lastExecutedAt,
      },
      recentExecutions,
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "tools:read");
    const q = params.query?.trim();
    const items = await prisma.automationCustomTool.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params.botId ? { botId: params.botId } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      take: params.limit ?? 20,
      select: {
        id: true,
        name: true,
        toolType: true,
        isActive: true,
        executionCount: true,
        avgDurationMs: true,
      },
    });
    return { items };
  },
};
