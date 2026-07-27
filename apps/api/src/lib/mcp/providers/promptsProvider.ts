import { prisma } from "../../../db.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const promptsProvider: McpProvider = {
  domain: "prompts",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "prompts:read");
    const modules = await prisma.automationPromptModule.findMany({
      where: { organizationId: ctx.organizationId },
      take: params?.limit ?? 50,
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, version: true },
    });
    return modules.map((m) => ({
      uri: `opennexo://prompts/${m.id}`,
      name: m.name,
      description: `Prompt module ${m.slug} v${m.version}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "prompts:read");
    const id = uri.replace("opennexo://prompts/", "");
    const mod = await prisma.automationPromptModule.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!mod) throw new Error("Prompt module not found");

    const revisions = await prisma.automationKnowledgeRevision.findMany({
      where: { articleId: id },
      take: 0,
    });

    return sanitizeForMcp({
      id: mod.id,
      name: mod.name,
      slug: mod.slug,
      version: mod.version,
      labels: mod.labels,
      bodyPreview: mod.body.slice(0, ctx.debugMode ? mod.body.length : 500),
      ...(ctx.debugMode ? { body: mod.body } : {}),
      revisionCount: revisions.length,
      updatedAt: mod.updatedAt,
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "prompts:read");
    const q = params.query?.trim();
    const items = await prisma.automationPromptModule.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { slug: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      take: params.limit ?? 20,
      select: { id: true, name: true, slug: true, version: true },
    });
    return { items };
  },
};

/** Obtém prompt final montado a partir de um perfil de agente. */
export async function getAgentPromptAssembly(
  ctx: McpAuthContext,
  botId: string,
): Promise<unknown> {
  requirePermission(ctx, ctx.debugMode ? "prompts:debug" : "prompts:read");
  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId, organizationId: ctx.organizationId },
    include: { bot: { select: { name: true } } },
  });
  if (!profile) throw new Error("Agent profile not found");

  const beh =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? (profile.behaviorConfig as Record<string, unknown>)
      : {};
  const pb =
    beh.promptBuilder && typeof beh.promptBuilder === "object"
      ? (beh.promptBuilder as Record<string, unknown>)
      : {};

  const moduleIds = Array.isArray(profile.promptModuleIds)
    ? (profile.promptModuleIds as string[])
    : [];
  const modules =
    moduleIds.length > 0
      ? await prisma.automationPromptModule.findMany({
          where: { id: { in: moduleIds }, organizationId: ctx.organizationId },
          select: { id: true, name: true, slug: true, body: true },
        })
      : [];

  return sanitizeForMcp({
    botId,
    botName: profile.bot.name,
    userCore: pb.userCore,
    blocks: pb.blocks,
    instructionFallbacks: pb.instructionFallbacks,
    modules: ctx.debugMode
      ? modules
      : modules.map((m) => ({ id: m.id, name: m.name, slug: m.slug })),
    ...(ctx.debugMode ? { fullPromptBuilder: pb } : {}),
  });
}
