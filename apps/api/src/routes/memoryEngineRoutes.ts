import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  loadOrgMemoryStore,
  saveOrgMemoryStore,
  listScopeMemories,
  saveScopeMemories,
} from "../lib/agent-engine/memory/openNexoMemoryRepository.js";
import {
  DEFAULT_MEMORY_ENGINE_ORG_CONFIG,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryRecord,
} from "../lib/agent-engine/memory/memoryEngineTypes.js";
import { createMemoryProvider } from "../lib/agent-engine/memory/MemoryProvider.js";
import { isMem0Configured } from "../lib/agent-engine/memory/mem0Client.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

const orgConfigSchema = z.object({
  mem0Enabled: z.boolean().optional(),
  provider: z.enum(["openconduit", "mem0"]).optional(),
  maxMemories: z.number().int().min(10).max(500).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  allowedCategories: z.array(z.enum(MEMORY_CATEGORIES as [MemoryCategory, ...MemoryCategory[]])).optional(),
  blockedCategories: z.array(z.enum(MEMORY_CATEGORIES as [MemoryCategory, ...MemoryCategory[]])).optional(),
  minScore: z.number().min(0).max(1).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  autoSummarize: z.boolean().optional(),
  autoCleanup: z.boolean().optional(),
});

const memoryRecordSchema = z.object({
  id: z.string().optional(),
  category: z.enum(MEMORY_CATEGORIES as [MemoryCategory, ...MemoryCategory[]]),
  text: z.string().min(1).max(2000),
  origin: z.enum(["agent", "manual", "system", "import"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "pinned", "archived"]).optional(),
  score: z.number().min(0).max(1).optional(),
});

export async function registerMemoryEngineRoutes(app: FastifyInstance): Promise<void> {
  app.get("/memory-engine/admin", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const store = await loadOrgMemoryStore(organizationId);
    return {
      data: {
        config: store.config,
        globalMemories: store.globalMemories,
        mem0Configured: isMem0Configured(),
        updatedAt: store.updatedAt,
      },
    };
  });

  app.patch("/memory-engine/admin", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const patch = orgConfigSchema.parse(request.body ?? {});
    const store = await loadOrgMemoryStore(organizationId);
    store.config = { ...store.config, ...patch };
    await saveOrgMemoryStore(organizationId, store);
    return { data: store };
  });

  app.post("/memory-engine/global", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const body = memoryRecordSchema.parse(request.body ?? {});
    const provider = createMemoryProvider("openconduit");
    const saved = await provider.save({
      organizationId,
      scope: "global",
      record: {
        category: body.category,
        text: body.text,
        origin: body.origin ?? "manual",
        confidence: body.confidence ?? 0.8,
        status: body.status ?? "active",
        scope: "global",
        score: body.score ?? 0.7,
      },
    });
    const store = await loadOrgMemoryStore(organizationId);
    store.globalMemories = await listScopeMemories({ organizationId, scope: "global" });
    await saveOrgMemoryStore(organizationId, store);
    return { data: saved };
  });

  app.get("/memory-engine/global/export", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const store = await loadOrgMemoryStore(organizationId);
    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", 'attachment; filename="memory-engine-global.json"');
    return {
      version: 1,
      organizationId,
      exportedAt: new Date().toISOString(),
      config: store.config,
      globalMemories: store.globalMemories,
    };
  });

  app.post("/memory-engine/global/import", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const body = request.body as {
      globalMemories?: MemoryRecord[];
      config?: Partial<typeof DEFAULT_MEMORY_ENGINE_ORG_CONFIG>;
    };
    const store = await loadOrgMemoryStore(organizationId);
    if (body.config) store.config = { ...store.config, ...body.config };
    if (Array.isArray(body.globalMemories)) {
      store.globalMemories = body.globalMemories;
      await saveScopeMemories({ organizationId, scope: "global" }, body.globalMemories);
    }
    await saveOrgMemoryStore(organizationId, store);
    return { data: store };
  });
}
