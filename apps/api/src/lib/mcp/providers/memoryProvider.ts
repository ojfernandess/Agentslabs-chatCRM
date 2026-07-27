import { prisma } from "../../../db.js";
import { parseAgentEngineConfig } from "../../agent-engine/config/parseAgentEngineConfig.js";
import { isMem0Configured } from "../../agent-engine/index.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const memoryProvider: McpProvider = {
  domain: "memory",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "memory:read");
    const contexts = await prisma.automationConversationContext.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
        ...(params?.conversationId ? { conversationId: params.conversationId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { updatedAt: "desc" },
      select: { conversationId: true, botId: true, updatedAt: true },
    });
    return contexts.map((c) => ({
      uri: `opennexo://memory/${c.conversationId}`,
      name: `Memory ${c.conversationId.slice(0, 8)}`,
      description: `Conversation memory context`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "memory:read");
    const conversationId = uri.replace("opennexo://memory/", "");
    const row = await prisma.automationConversationContext.findFirst({
      where: { conversationId, organizationId: ctx.organizationId },
      include: { bot: { select: { name: true } } },
    });
    if (!row) throw new Error("Memory context not found");

    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: row.botId },
      select: { behaviorConfig: true },
    });
    const engine = parseAgentEngineConfig(profile?.behaviorConfig);

    return sanitizeForMcp({
      conversationId,
      botId: row.botId,
      botName: row.bot.name,
      provider: engine.memory,
      mem0Configured: isMem0Configured(),
      updatedAt: row.updatedAt,
      lastClearedAt: row.lastClearedAt,
      clearPolicy: row.clearPolicy,
      state: ctx.debugMode ? row.state : summarizeMemoryState(row.state),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "memory:read");
    const items = await prisma.automationConversationContext.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params.botId ? { botId: params.botId } : {}),
      },
      take: params.limit ?? 20,
      orderBy: { updatedAt: "desc" },
      select: { conversationId: true, botId: true, updatedAt: true },
    });
    return { items, mem0Configured: isMem0Configured() };
  },
};

function summarizeMemoryState(state: unknown): unknown {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  return {
    keys: Object.keys(s),
    hasSummary: Boolean(s.summary || s.conversationSummary),
    turnCount: Array.isArray(s.turns) ? s.turns.length : undefined,
  };
}
