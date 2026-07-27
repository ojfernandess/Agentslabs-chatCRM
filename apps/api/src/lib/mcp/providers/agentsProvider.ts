import { prisma } from "../../../db.js";
import { parseAgentEngineConfig } from "../../agent-engine/config/parseAgentEngineConfig.js";
import { requirePermission } from "../access/permissions.js";
import { assertBotAccess } from "../auth/resolveMcpAuth.js";
import { llmConfigSafeSummary, sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

function botScope(ctx: McpAuthContext) {
  return ctx.allowedBotIds?.length ? { id: { in: ctx.allowedBotIds } } : {};
}

export const agentsProvider: McpProvider = {
  domain: "agents",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "agents:read");
    const limit = Math.min(params?.limit ?? 50, 100);
    const bots = await prisma.bot.findMany({
      where: { organizationId: ctx.organizationId, ...botScope(ctx) },
      take: limit,
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    });
    return bots.map((b) => ({
      uri: `opennexo://agents/${b.id}`,
      name: b.name,
      description: `Agent ${b.name} (${b.isActive ? "active" : "inactive"})`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "agents:read");
    const id = uri.replace("opennexo://agents/", "");
    assertBotAccess(ctx, id);

    const bot = await prisma.bot.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        automationProfile: true,
        automationCustomTools: { where: { isActive: true }, take: 100 },
      },
    });
    if (!bot) throw new Error("Agent not found");

    const beh =
      bot.automationProfile?.behaviorConfig && typeof bot.automationProfile.behaviorConfig === "object"
        ? (bot.automationProfile.behaviorConfig as Record<string, unknown>)
        : {};
    const engine = parseAgentEngineConfig(beh);

    const recentExecutions = await prisma.automationExecution.findMany({
      where: { botId: id, organizationId: ctx.organizationId },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        workflowKey: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
      },
    });

    return sanitizeForMcp({
      id: bot.id,
      name: bot.name,
      description: bot.description,
      isActive: bot.isActive,
      type: bot.type,
      llm: bot.automationProfile ? llmConfigSafeSummary(bot.automationProfile.llmConfig) : null,
      engine,
      promptModuleIds: bot.automationProfile?.promptModuleIds ?? [],
      tools: bot.automationCustomTools.map((t) => ({
        id: t.id,
        name: t.name,
        toolType: t.toolType,
        executionCount: t.executionCount,
        avgDurationMs: t.avgDurationMs,
        lastExecutedAt: t.lastExecutedAt,
      })),
      recentExecutions,
      ...(ctx.debugMode
        ? {
            behaviorConfig: beh,
            connectedTools: beh.connectedTools,
            promptBuilder: beh.promptBuilder,
          }
        : {}),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "agents:read");
    const q = params.query?.trim();
    const bots = await prisma.bot.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...botScope(ctx),
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      take: params.limit ?? 20,
      select: { id: true, name: true, isActive: true, type: true },
    });
    return { items: bots };
  },
};
