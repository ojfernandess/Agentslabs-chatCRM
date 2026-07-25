import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  loadOrgKnowledgeStore,
  saveOrgKnowledgeStore,
} from "../lib/agent-engine/knowledge/knowledgeOrgRepository.js";
import {
  DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG,
  type KnowledgeProviderKind,
} from "../lib/agent-engine/knowledge/knowledgeEngineTypes.js";
import {
  createKnowledgeProvider,
} from "../lib/agent-engine/knowledge/KnowledgeProvider.js";
import {
  clearKnowledgeCache,
  getKnowledgeCacheStats,
} from "../lib/agent-engine/knowledge/knowledgeCache.js";
import { runKnowledgeInspector } from "../lib/agent-engine/knowledge/knowledgeInspectorService.js";
import { parseKnowledgeEngineConfig } from "../lib/agent-engine/knowledge/parseKnowledgeEngineConfig.js";
import { prisma } from "../db.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

const orgConfigSchema = z.object({
  provider: z.enum(["openconduit", "llamaindex"]).optional(),
  maxDocuments: z.number().int().min(1).max(50).optional(),
  maxChunks: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  autoIndex: z.boolean().optional(),
  cacheEnabled: z.boolean().optional(),
  reranking: z.boolean().optional(),
  citations: z.boolean().optional(),
});

const inspectorSchema = z.object({
  query: z.string().min(1).max(2000),
  botId: z.string().uuid().optional(),
  provider: z.enum(["openconduit", "llamaindex"]).optional(),
  maxDocuments: z.number().int().min(1).max(50).optional(),
  maxChunks: z.number().int().min(1).max(100).optional(),
  reranking: z.boolean().optional(),
  citations: z.boolean().optional(),
  pinnedArticleIds: z.array(z.string().uuid()).optional(),
});

export async function registerKnowledgeEngineRoutes(app: FastifyInstance): Promise<void> {
  app.get("/knowledge-engine/admin", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const store = await loadOrgKnowledgeStore(organizationId);
    const cacheStats = getKnowledgeCacheStats();
    return {
      data: {
        config: store.config,
        cacheStats,
        updatedAt: store.updatedAt,
      },
    };
  });

  app.patch("/knowledge-engine/admin", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const patch = orgConfigSchema.parse(request.body ?? {});
    const store = await loadOrgKnowledgeStore(organizationId);
    store.config = { ...store.config, ...patch };
    await saveOrgKnowledgeStore(organizationId, store);
    return { data: store };
  });

  app.post("/knowledge-engine/admin/clear-cache", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const removed = clearKnowledgeCache({ organizationId });
    return { data: { removed, cacheStats: getKnowledgeCacheStats() } };
  });

  app.get("/knowledge-engine/center", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [articleCount, chunkCount, categoryRows, lastArticle] = await Promise.all([
      prisma.automationKnowledgeArticle.count({ where: { organizationId, isActive: true } }),
      prisma.automationKnowledgeChunk.count({
        where: { article: { organizationId, isActive: true } },
      }),
      prisma.automationKnowledgeArticle.groupBy({
        by: ["category"],
        where: { organizationId, isActive: true },
        _count: { _all: true },
      }),
      prisma.automationKnowledgeArticle.findFirst({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true, title: true },
      }),
    ]);

    const tokenEstimate = chunkCount * 220;
    const categories = categoryRows
      .filter((r) => r.category)
      .map((r) => ({ name: r.category!, count: r._count._all }));

    const store = await loadOrgKnowledgeStore(organizationId);

    return {
      data: {
        documents: articleCount,
        chunks: chunkCount,
        tokenEstimate,
        categories,
        lastIndexedAt: lastArticle?.updatedAt?.toISOString() ?? null,
        lastDocumentName: lastArticle?.title ?? null,
        orgConfig: store.config,
        cacheStats: getKnowledgeCacheStats(),
      },
    };
  });

  app.post("/knowledge-engine/inspector", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const body = inspectorSchema.parse(request.body ?? {});
    const orgStore = await loadOrgKnowledgeStore(organizationId);
    const config = parseKnowledgeEngineConfig({
      knowledgeEngine: {
        provider: body.provider ?? orgStore.config.provider,
        enabled: true,
        maxDocuments: body.maxDocuments ?? orgStore.config.maxDocuments,
        maxChunks: body.maxChunks ?? orgStore.config.maxChunks,
        reranking: body.reranking ?? orgStore.config.reranking,
        citations: body.citations ?? orgStore.config.citations,
        minScore: orgStore.config.minScore,
        minSimilarity: orgStore.config.minSimilarity,
      },
    });

    const trace = await runKnowledgeInspector({
      organizationId,
      botId: body.botId,
      query: body.query,
      config,
      pinnedArticleIds: body.pinnedArticleIds,
      cacheEnabled: orgStore.config.cacheEnabled,
    });

    return { data: trace };
  });

  app.post("/knowledge-engine/reindex", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const body = z
      .object({ documentId: z.string().uuid().optional(), provider: z.enum(["openconduit", "llamaindex"]).optional() })
      .parse(request.body ?? {});

    const providerKind: KnowledgeProviderKind = body.provider ?? DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG.provider;
    const provider = createKnowledgeProvider(providerKind);
    const result = await provider.index({ organizationId, documentId: body.documentId, force: true });
    return { data: result };
  });

  app.get("/knowledge-engine/documents", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const q = request.query as { botId?: string; limit?: string };
    const orgStore = await loadOrgKnowledgeStore(organizationId);
    const provider = createKnowledgeProvider(orgStore.config.provider);
    const documents = await provider.listDocuments({
      organizationId,
      botId: q.botId,
      limit: q.limit ? Math.min(100, Number(q.limit) || 50) : 50,
    });
    return { data: documents };
  });
}
