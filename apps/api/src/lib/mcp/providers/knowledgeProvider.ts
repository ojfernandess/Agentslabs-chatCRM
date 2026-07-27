import { prisma } from "../../../db.js";
import { parseKnowledgeEngineConfig } from "../../agent-engine/knowledge/parseKnowledgeEngineConfig.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const knowledgeProvider: McpProvider = {
  domain: "knowledge",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "knowledge:read");
    const articles = await prisma.automationKnowledgeArticle.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        ...(params?.query
          ? { title: { contains: params.query, mode: "insensitive" } }
          : {}),
      },
      take: params?.limit ?? 30,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, category: true },
    });
    return articles.map((a) => ({
      uri: `opennexo://knowledge/${a.id}`,
      name: a.title,
      description: a.category ?? "Knowledge article",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "knowledge:read");
    const id = uri.replace("opennexo://knowledge/", "");
    const article = await prisma.automationKnowledgeArticle.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        chunks: { orderBy: { chunkIndex: "asc" }, take: ctx.debugMode ? 100 : 5 },
        botLinks: { select: { botId: true } },
      },
    });
    if (!article) throw new Error("Knowledge article not found");

    return sanitizeForMcp({
      id: article.id,
      title: article.title,
      category: article.category,
      tags: article.tags,
      isActive: article.isActive,
      syncToAi: article.syncToAi,
      sourceFileName: article.sourceFileName,
      chunkCount: article.chunks.length,
      linkedBotIds: article.botLinks.map((l) => l.botId),
      chunks: article.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        textPreview: c.text.slice(0, ctx.debugMode ? c.text.length : 200),
        embeddingModel: c.embeddingModel,
        dimensions: c.dimensions,
      })),
      ...(ctx.debugMode ? { content: article.content } : {}),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "knowledge:read");
    const q = params.query?.trim();
    const items = await prisma.automationKnowledgeArticle.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { content: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      take: params.limit ?? 20,
      select: { id: true, title: true, category: true, tags: true },
    });
    return { items, provider: "openconduit_pgvector" };
  },
};

export const vectorProvider: McpProvider = {
  domain: "vector",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "vector:read");
    const articles = await prisma.automationKnowledgeArticle.findMany({
      where: { organizationId: ctx.organizationId, isActive: true },
      take: params?.limit ?? 20,
      select: { id: true, title: true },
    });
    return articles.map((a) => ({
      uri: `opennexo://vector/${a.id}`,
      name: `Vector collection ${a.title}`,
      description: "pgvector embeddings for article chunks",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "vector:read");
    const articleId = uri.replace("opennexo://vector/", "");
    const chunks = await prisma.automationKnowledgeChunk.findMany({
      where: { articleId, organizationId: ctx.organizationId },
      orderBy: { chunkIndex: "asc" },
      take: ctx.debugMode ? 200 : 20,
      select: {
        id: true,
        chunkIndex: true,
        text: true,
        embeddingModel: true,
        dimensions: true,
        createdAt: true,
      },
    });
    if (!chunks.length) throw new Error("Vector collection not found");

    return sanitizeForMcp({
      backend: "pgvector",
      note: "OpenNexo usa PostgreSQL pgvector; Qdrant não está configurado nesta instalação.",
      articleId,
      collection: `kb_article_${articleId}`,
      chunkCount: chunks.length,
      embeddings: chunks.map((c) => ({
        id: c.id,
        chunkIndex: c.chunkIndex,
        model: c.embeddingModel,
        dimensions: c.dimensions,
        textPreview: c.text.slice(0, 120),
      })),
    });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "vector:search");
    const q = params.query?.trim();
    if (!q) return { items: [], note: "Provide query for vector search" };

    const chunks = await prisma.automationKnowledgeChunk.findMany({
      where: {
        organizationId: ctx.organizationId,
        text: { contains: q, mode: "insensitive" },
      },
      take: params.limit ?? 10,
      select: {
        id: true,
        articleId: true,
        chunkIndex: true,
        text: true,
        embeddingModel: true,
      },
    });
    return {
      backend: "pgvector",
      query: q,
      items: chunks.map((c) => ({
        chunkId: c.id,
        articleId: c.articleId,
        chunkIndex: c.chunkIndex,
        score: null,
        textPreview: c.text.slice(0, 200),
        note: "Semantic score requires embedding query via knowledge engine",
      })),
    };
  },
};

/** Retorna configuração do knowledge engine de um agente. */
export async function getAgentKnowledgeConfig(
  ctx: McpAuthContext,
  botId: string,
): Promise<unknown> {
  requirePermission(ctx, "knowledge:read");
  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId, organizationId: ctx.organizationId },
    select: { behaviorConfig: true },
  });
  if (!profile) throw new Error("Agent not found");
  const beh =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? (profile.behaviorConfig as Record<string, unknown>)
      : {};
  return sanitizeForMcp(parseKnowledgeEngineConfig(beh));
}
