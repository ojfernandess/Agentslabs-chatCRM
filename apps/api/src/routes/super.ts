import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID, randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { config } from "../config.js";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import { getRedisHealth } from "../lib/redisHealth.js";
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagKey } from "../lib/featureFlags.js";
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_TAGS,
  DEFAULT_LEAD_TYPES,
} from "@openconduit/shared";

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.slice(0, 80) || `org-${randomUUID().slice(0, 8)}`;
}

const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
});

const patchOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

const platformAppCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  organizationId: z.string().uuid().optional(),
});

const featureFlagPatchSchema = z.object({
  key: z.string().min(1).max(64),
  enabled: z.boolean(),
});

function superJwtBase(request: { user: JwtPayload }): JwtPayload {
  return {
    id: request.user.id,
    email: request.user.email,
    role: "SUPER_ADMIN",
    organizationId: request.user.organizationId ?? null,
  };
}

function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return FEATURE_FLAG_DEFINITIONS.some((d) => d.key === key);
}

async function fetchPlatformStats() {
  const [organizationTotal, organizationActive, userTotal, contactTotal, conversationOpen] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: { in: ["ADMIN", "AGENT"] } } }),
    prisma.contact.count(),
    prisma.conversation.count({ where: { status: "OPEN" } }),
  ]);
  return {
    organizationTotal,
    organizationActive,
    organizationSuspended: organizationTotal - organizationActive,
    userTotal,
    contactTotal,
    conversationOpen,
  };
}

async function safeAudit(
  request: { log: { warn: (o: unknown, m: string) => void } },
  input: Parameters<typeof recordAuditLog>[0],
): Promise<void> {
  try {
    await recordAuditLog(input);
  } catch (err) {
    request.log.warn({ err }, "audit_log_failed");
  }
}

export async function superRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/stats", async () => fetchPlatformStats());

  app.get("/monitoring", async () => {
    const dbStart = Date.now();
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    const dbLatencyMs = Date.now() - dbStart;
    const redis = await getRedisHealth();

    return {
      database: { ok: dbOk, latencyMs: dbLatencyMs },
      redis,
      backgroundJobs: {
        mode: "bullmq_ready",
        note:
          "Workers BullMQ podem ser adicionados como processos separados; Redis está disponível para filas.",
      },
    };
  });

  app.get("/audit-logs", async (request, reply) => {
    const q = auditQuerySchema.safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ error: "Bad Request", message: q.error.message, statusCode: 400 });
    }
    const { page, limit, organizationId } = q.data;
    const where = organizationId ? { organizationId } : {};
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);
    return {
      data: rows,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  });

  app.get("/platform-applications", async () => {
    return prisma.platformApplication.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        tokenPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });
  });

  app.post("/platform-applications", async (request, reply) => {
    const parsed = platformAppCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const token = `ocp_${randomBytes(32).toString("base64url")}`;
    const tokenPrefix = token.slice(0, 12);
    const tokenHash = await bcrypt.hash(token, config.bcryptCostFactor);
    const row = await prisma.platformApplication.create({
      data: {
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        tokenPrefix,
        tokenHash,
        createdById: request.user.id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        tokenPrefix: true,
        createdAt: true,
        createdBy: { select: { email: true, name: true } },
      },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.platform_application.create",
      resourceType: "platform_application",
      resourceId: row.id,
      metadata: { name: row.name },
      ip: clientIp(request),
    });
    return reply.status(201).send({ ...row, token });
  });

  app.delete<{ Params: { id: string } }>("/platform-applications/:id", async (request, reply) => {
    try {
      await prisma.platformApplication.delete({ where: { id: request.params.id } });
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Application not found", statusCode: 404 });
    }
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.platform_application.delete",
      resourceType: "platform_application",
      resourceId: request.params.id,
      ip: clientIp(request),
    });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/organizations/:id/feature-flags", async (request, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: request.params.id },
      select: { id: true, name: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }
    const rows = await prisma.organizationFeatureFlag.findMany({
      where: { organizationId: org.id },
    });
    const map = new Map(rows.map((r) => [r.key, r.enabled]));
    return {
      organizationId: org.id,
      organizationName: org.name,
      flags: FEATURE_FLAG_DEFINITIONS.map((def) => ({
        key: def.key,
        enabled: map.has(def.key) ? map.get(def.key)! : def.defaultEnabled,
        defaultEnabled: def.defaultEnabled,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/organizations/:id/feature-flags", async (request, reply) => {
    const parsed = featureFlagPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    if (!isFeatureFlagKey(parsed.data.key)) {
      return reply.status(400).send({ error: "Bad Request", message: "Unknown feature flag key", statusCode: 400 });
    }
    const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }
    await prisma.organizationFeatureFlag.upsert({
      where: {
        organizationId_key: { organizationId: org.id, key: parsed.data.key },
      },
      create: {
        organizationId: org.id,
        key: parsed.data.key,
        enabled: parsed.data.enabled,
      },
      update: { enabled: parsed.data.enabled },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: org.id,
      action: "super.feature_flag.update",
      resourceType: "feature_flag",
      resourceId: parsed.data.key,
      metadata: { enabled: parsed.data.enabled },
      ip: clientIp(request),
    });
    return { ok: true, key: parsed.data.key, enabled: parsed.data.enabled };
  });

  app.get("/organizations", async () => {
    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { users: true, contacts: true, conversations: true } },
      },
    });
    const stats = await fetchPlatformStats();
    return { organizations, stats };
  });

  app.post<{ Params: { id: string } }>("/organizations/:id/enter", async (request, reply) => {
    const org = await prisma.organization.findFirst({
      where: { id: request.params.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!org) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Organização não encontrada ou suspensa",
        statusCode: 404,
      });
    }
    const payload: JwtPayload = { ...superJwtBase(request), actingOrganizationId: org.id };
    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: org.id,
      action: "super.impersonate.enter",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { organizationName: org.name },
      ip: clientIp(request),
    });
    return { token: request.server.jwt.sign(payload) };
  });

  app.post("/session/exit-organization", async (request) => {
    const acting = request.user.actingOrganizationId;
    const payload = superJwtBase(request);
    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: acting ?? undefined,
      action: "super.impersonate.exit",
      resourceType: "organization",
      resourceId: acting ?? null,
      ip: clientIp(request),
    });
    return { token: request.server.jwt.sign(payload) };
  });

  app.post("/organizations", async (request, reply) => {
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const slug = (parsed.data.slug?.trim() || slugify(parsed.data.name)).slice(0, 80);
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      return reply.status(409).send({ error: "Conflict", message: "Slug já em uso", statusCode: 409 });
    }

    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({
        data: { name: parsed.data.name.trim(), slug, isActive: true },
      });
      await tx.settings.create({ data: { organizationId: o.id } });
      for (const stage of DEFAULT_PIPELINE_STAGES) {
        await tx.pipelineStage.create({
          data: {
            organizationId: o.id,
            name: stage.name,
            order: stage.order,
            color: stage.color,
          },
        });
      }
      for (const lt of DEFAULT_LEAD_TYPES) {
        await tx.leadType.create({
          data: {
            organizationId: o.id,
            name: lt.name,
            color: lt.color,
            order: lt.order,
          },
        });
      }
      for (const tag of DEFAULT_TAGS) {
        await tx.tag.create({
          data: { organizationId: o.id, name: tag.name, color: tag.color },
        });
      }
      await tx.tag.create({
        data: { organizationId: o.id, name: "Desconhecido", color: "#9ca3af" },
      });
      return o;
    });

    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: org.id,
      action: "super.organization.create",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug },
      ip: clientIp(request),
    });

    return reply.status(201).send(org);
  });

  app.patch<{ Params: { id: string } }>("/organizations/:id", async (request, reply) => {
    const parsed = patchOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    let org;
    try {
      org = await prisma.organization.update({
        where: { id: request.params.id },
        data: parsed.data,
      });
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }
    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: org.id,
      action: "super.organization.update",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { patch: parsed.data },
      ip: clientIp(request),
    });
    return org;
  });
}
