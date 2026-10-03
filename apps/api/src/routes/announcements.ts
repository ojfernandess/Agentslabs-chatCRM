import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireSuperAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { persistUserAvatarUpload } from "../lib/profileImageUpload.js";
import { queueAnnouncementFanout } from "../lib/announcements/announcementFanout.js";
import {
  AnnouncementError,
  acknowledgeForUser,
  adminGet,
  adminList,
  archiveAnnouncement,
  createAnnouncement,
  duplicateAnnouncement,
  getForOrganization,
  inboxForUser,
  listActivePlans,
  listCategories,
  listForOrganization,
  markAllRead,
  metricsForAnnouncement,
  previewAudience,
  renotifyAnnouncement,
  saveCategory,
  searchOrganizations,
  softDeleteAnnouncement,
  updateAnnouncement,
  type AnnouncementWriteInput,
} from "../lib/announcements/announcementService.js";

const audienceSchema = z.object({
  type: z.enum(["ALL", "ORGANIZATIONS", "PLANS"]),
  organizationIds: z.array(z.string().uuid()).max(200).optional(),
  planIds: z.array(z.string().uuid()).max(50).optional(),
});

const writeSchema = z.object({
  title: z.string().trim().min(3).max(180),
  summary: z.string().trim().min(3).max(500),
  content: z.string().trim().min(1).max(30000),
  categoryId: z.string().uuid(),
  coverUrl: z.string().trim().max(2048).nullable().optional(),
  priority: z.enum(["NORMAL", "IMPORTANT", "CRITICAL"]),
  isFeatured: z.boolean(),
  isPinned: z.boolean(),
  notifyUsers: z.boolean(),
  requiresAcknowledgement: z.boolean(),
  scheduledAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  ctaLabel: z.string().trim().max(80).nullable().optional(),
  ctaUrl: z.string().trim().max(2048).nullable().optional(),
  audience: audienceSchema,
  action: z.enum(["draft", "publish", "schedule"]),
});

function pageQuery(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

function sendError(err: unknown): { statusCode: number; body: { error: string; message: string; statusCode: number } } | null {
  if (err instanceof AnnouncementError) {
    return {
      statusCode: err.statusCode,
      body: { error: err.statusCode === 404 ? "Not Found" : "Bad Request", message: err.message, statusCode: err.statusCode },
    };
  }
  if (err instanceof z.ZodError) {
    return { statusCode: 400, body: { error: "Bad Request", message: "Dados inválidos", statusCode: 400 } };
  }
  return null;
}

export async function announcementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/inbox", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return inboxForUser(organizationId, request.user.id);
  });

  app.get("/categories", { preHandler: [authenticate] }, async () => listCategories(true));

  app.post("/read-all", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return markAllRead(organizationId, request.user.id);
  });

  app.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const query = request.query as { page?: string; pageSize?: string; q?: string; category?: string; unread?: string };
    const { page, pageSize } = pageQuery(query);
    return listForOrganization({
      organizationId,
      userId: request.user.id,
      page,
      pageSize,
      q: query.q,
      categorySlug: query.category?.trim() || undefined,
      unreadOnly: query.unread === "1",
    });
  });

  app.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const row = await getForOrganization(organizationId, request.user.id, id);
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Publicação não encontrada", statusCode: 404 });
    }
    return row;
  });

  app.post("/:id/acknowledge", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    try {
      const row = await acknowledgeForUser(organizationId, request.user.id, id);
      if (!row) {
        return reply.status(404).send({ error: "Not Found", message: "Publicação não encontrada", statusCode: 404 });
      }
      return row;
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });
}

export async function superAnnouncementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/categories", async () => listCategories(false));

  app.post("/categories", async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(400).nullable().optional(),
      icon: z.string().trim().min(2).max(40),
      tone: z.string().trim().min(2).max(24),
      sortOrder: z.number().int().min(0).max(999).optional(),
    }).parse(request.body);
    try {
      return await saveCategory({ ...body, actorUserId: request.user.id });
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.patch("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(400).nullable().optional(),
      icon: z.string().trim().min(2).max(40),
      tone: z.string().trim().min(2).max(24),
      sortOrder: z.number().int().min(0).max(999).optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body);
    try {
      return await saveCategory({ ...body, id, actorUserId: request.user.id });
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.get("/plans", async () => listActivePlans());

  app.get("/organizations", async (request) => {
    const q = (request.query as { q?: string }).q ?? "";
    return searchOrganizations(q);
  });

  app.post("/audience-preview", async (request, reply) => {
    try {
      const body = audienceSchema.parse(request.body);
      return await previewAudience(body);
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.post("/cover", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) {
      return reply.status(400).send({ error: "Bad Request", message: "Arquivo obrigatório", statusCode: 400 });
    }
    const coverUrl = await persistUserAvatarUpload(file, reply);
    if (!coverUrl) return;
    return { coverUrl };
  });

  app.get("/", async (request) => {
    const query = request.query as { page?: string; pageSize?: string; q?: string; status?: string; categoryId?: string };
    const { page, pageSize } = pageQuery(query);
    const status = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(query.status ?? "")
      ? (query.status as "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED")
      : undefined;
    return adminList({ page, pageSize, q: query.q, status, categoryId: query.categoryId });
  });

  app.get("/:id/metrics", async (request, reply) => {
    const { id } = request.params as { id: string };
    const metrics = await metricsForAnnouncement(id);
    if (!metrics) return reply.status(404).send({ error: "Not Found", message: "Publicação não encontrada", statusCode: 404 });
    return metrics;
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await adminGet(id);
    if (!row) return reply.status(404).send({ error: "Not Found", message: "Publicação não encontrada", statusCode: 404 });
    return row;
  });

  async function write(request: { body: unknown; user: { id: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }, id?: string) {
    try {
      const body = writeSchema.parse(request.body) as AnnouncementWriteInput;
      const result = id
        ? await updateAnnouncement(id, body, request.user.id)
        : await createAnnouncement(body, request.user.id);
      if (result.shouldNotify) queueAnnouncementFanout(result.announcement.id);
      return result.announcement;
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  }

  app.post("/", async (request, reply) => write(request, reply));

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return write(request, reply, id);
  });

  app.post("/:id/archive", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await archiveAnnouncement(id, request.user.id);
      return { ok: true };
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.post("/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await duplicateAnnouncement(id, request.user.id);
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.post("/:id/renotify", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await renotifyAnnouncement(id, request.user.id);
      queueAnnouncementFanout(id);
      return { ok: true };
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await softDeleteAnnouncement(id, request.user.id);
      return { ok: true };
    } catch (err) {
      const mapped = sendError(err);
      if (mapped) return reply.status(mapped.statusCode).send(mapped.body);
      throw err;
    }
  });
}
