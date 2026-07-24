import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  buildMemoryCenterView,
  deleteContactMemoryRecord,
  exportContactMemories,
  importContactMemories,
  patchContactMemoryRecord,
  searchMemoryCenterContacts,
  updateMemoryCenterForConversation,
} from "../lib/agent-engine/memory/memoryCenterService.js";
import { MEMORY_CATEGORIES, type MemoryCategory } from "../lib/agent-engine/memory/memoryEngineTypes.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

const patchSchema = z.object({
  preferences: z.record(z.string()).optional(),
  aiMemories: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        source: z.enum(["agent", "manual", "system"]).optional(),
      }),
    )
    .optional(),
  score: z.number().min(0).max(100).nullable().optional(),
});

const memoryPatchSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  category: z.enum(MEMORY_CATEGORIES as [MemoryCategory, ...MemoryCategory[]]).optional(),
  status: z.enum(["active", "pinned", "archived"]).optional(),
  score: z.number().min(0).max(1).optional(),
});

const importSchema = z.object({
  memories: z.array(
    z.object({
      text: z.string().min(1).max(2000),
      category: z.enum(MEMORY_CATEGORIES as [MemoryCategory, ...MemoryCategory[]]).optional(),
      status: z.enum(["active", "pinned", "archived"]).optional(),
      source: z.enum(["agent", "manual", "system", "import"]).optional(),
    }),
  ),
});

export async function registerMemoryCenterRoutes(app: FastifyInstance): Promise<void> {
  app.get("/memory-center/search", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const q = String((request.query as { q?: string }).q ?? "").trim();
    const data = await searchMemoryCenterContacts(organizationId, q);
    return { data };
  });

  app.get("/memory-center/by-contact/:contactId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { contactId } = request.params as { contactId: string };
    const conversationId = String((request.query as { conversationId?: string }).conversationId ?? "").trim() || null;
    const data = await buildMemoryCenterView({ organizationId, contactId, conversationId });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
    return { data };
  });

  app.get("/memory-center/by-conversation/:conversationId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId } = request.params as { conversationId: string };
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { contactId: true },
    });
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    const data = await buildMemoryCenterView({
      organizationId,
      contactId: conv.contactId,
      conversationId,
    });
    return { data };
  });

  app.patch("/memory-center/by-conversation/:conversationId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId } = request.params as { conversationId: string };
    const patch = patchSchema.parse(request.body ?? {});
    const data = await updateMemoryCenterForConversation({
      organizationId,
      conversationId,
      patch,
    });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    return { data };
  });

  app.patch("/memory-center/by-conversation/:conversationId/memory/:memoryId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId, memoryId } = request.params as { conversationId: string; memoryId: string };
    const patch = memoryPatchSchema.parse(request.body ?? {});
    const data = await patchContactMemoryRecord({
      organizationId,
      conversationId,
      memoryId,
      patch,
    });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    return { data };
  });

  app.delete("/memory-center/by-conversation/:conversationId/memory/:memoryId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId, memoryId } = request.params as { conversationId: string; memoryId: string };
    const data = await deleteContactMemoryRecord({ organizationId, conversationId, memoryId });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    return { data };
  });

  app.get("/memory-center/by-conversation/:conversationId/export", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId } = request.params as { conversationId: string };
    const data = await exportContactMemories({ organizationId, conversationId });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", 'attachment; filename="memory-center-export.json"');
    return data;
  });

  app.post("/memory-center/by-conversation/:conversationId/import", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { conversationId } = request.params as { conversationId: string };
    const body = importSchema.parse(request.body ?? {});
    const data = await importContactMemories({
      organizationId,
      conversationId,
      memories: body.memories,
    });
    if (!data) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    return { data };
  });
}
