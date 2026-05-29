import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID, randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";
import { Prisma } from "@prisma/client";
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
import {
  WHATSAPP_EMBEDDED_PLATFORM_KEY,
} from "../lib/metaWhatsAppEmbedded.js";
import { metaEmbeddedWebhookUrl } from "../config.js";
import {
  EVOLUTION_PLATFORM_KEY,
  parseEvolutionPlatformValue,
} from "../lib/evolutionPlatform.js";
import { EVOLUTION_GO_PLATFORM_KEY, parseEvolutionGoPlatformValue } from "../lib/evolutionGoPlatform.js";
import {
  RESEND_EMAIL_PLATFORM_KEY,
  getPasswordResetTemplatesForEditor,
  getUserInviteTemplatesForEditor,
  parseResendEmailValue,
} from "../lib/resendEmailSettings.js";
import {
  MEDIA_STORAGE_PLATFORM_KEY,
  parseMediaStoragePlatformValue,
} from "../lib/mediaStorageSettings.js";
import { invalidateMediaStorageCache } from "../lib/mediaStorage.js";
import {
  buildConversationMediaInventory,
  deleteConversationMediaFiles,
  filterConversationMediaInventory,
  getConversationMediaInventoryStats,
  paginateConversationMediaInventory,
  summarizeConversationMediaByOrganization,
} from "../lib/conversationMediaAdmin.js";
import { MESSAGE_MEDIA_FILENAME_RE } from "../lib/messageMediaFilename.js";
import {
  getConversationMediaRetentionFromDb,
  saveConversationMediaRetentionValue,
  type ConversationMediaRetentionMonths,
} from "../lib/conversationMediaRetentionSettings.js";
import { runConversationMediaRetentionTick } from "../lib/conversationMediaRetentionJob.js";
import { addAgentToAllOrganizationTeams } from "../lib/agentScope.js";
import { ensureDefaultInboxForOrganization } from "../lib/defaultInbox.js";

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
  slug: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
  planTier: z.enum(["free", "growth", "enterprise"]).optional(),
  billingEmail: z.union([z.string().email(), z.literal("")]).optional(),
  monthlyMessageQuota: z.union([z.number().int().positive(), z.null()]).optional(),
});

const superUserPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.enum(["ADMIN", "AGENT"]).optional(),
});

const superUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).optional(),
  organizationId: z.string().uuid().optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "AGENT"]).optional(),
  unassigned: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const superPlatformUserPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "AGENT"]).optional(),
  organizationId: z.union([z.string().uuid(), z.null()]).optional(),
});

const platformSettingUpsertSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
});

const whatsappEmbeddedPutSchema = z.object({
  appId: z.string().min(1).max(64),
  appSecret: z.string().max(256).optional(),
  configurationId: z.string().min(1).max(64),
  apiVersion: z.string().max(16).default("v22.0"),
  webhookVerifyToken: z.string().min(4).max(256),
});

const evolutionPlatformPutSchema = z.object({
  enabled: z.boolean(),
  tenantQrOnly: z.boolean().optional(),
  baseUrl: z.string().max(512),
  globalApiKey: z.string().max(512).optional(),
});

const evolutionGoPlatformPutSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().max(512),
  globalApiKey: z.string().max(512).optional(),
});

const resendEmailPutSchema = z.object({
  apiKey: z.string().max(512).optional(),
  fromEmail: z.string().email(),
  fromName: z.string().min(1).max(120).optional(),
  systemLogoUrl: z.string().max(2000).optional(),
  passwordResetSubject: z.string().max(200).optional(),
  passwordResetHtmlTemplate: z.string().max(100_000).optional(),
  userInviteSubject: z.string().max(200).optional(),
  userInviteHtmlTemplate: z.string().max(100_000).optional(),
});

const mediaStoragePutSchema = z.object({
  enabled: z.boolean(),
  driver: z.enum(["local", "minio"]),
  endpoint: z.string().max(500).optional(),
  bucket: z.string().max(120).optional(),
  accessKey: z.string().max(256).optional(),
  secretKey: z.string().max(256).optional(),
  useSsl: z.boolean().optional(),
  region: z.string().max(64).optional(),
  publicBaseUrl: z.string().max(500).optional(),
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

const conversationMediaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).optional(),
  storage: z.enum(["all", "local", "minio", "both", "db_only"]).optional(),
  organizationId: z.string().uuid().optional(),
  type: z.string().max(32).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const conversationMediaBulkDeleteSchema = z.object({
  filenames: z.array(z.string().min(1).max(128)).min(1).max(100),
});

const conversationMediaRetentionPutSchema = z.object({
  enabled: z.boolean(),
  retentionMonths: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
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
      const pipeline = await tx.pipeline.create({
        data: {
          organizationId: o.id,
          name: "Pipeline principal",
          isDefault: true,
          sortOrder: 0,
        },
      });
      for (const stage of DEFAULT_PIPELINE_STAGES) {
        await tx.pipelineStage.create({
          data: {
            pipelineId: pipeline.id,
            name: stage.name,
            order: stage.order,
            color: stage.color,
            probabilityPct: stage.probabilityPct,
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
            valueRollup: lt.valueRollup,
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

    await ensureDefaultInboxForOrganization(org.id);

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
      const p = parsed.data;
      const data: Prisma.OrganizationUpdateInput = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.slug !== undefined) data.slug = slugify(p.slug);
      if (p.isActive !== undefined) data.isActive = p.isActive;
      if (p.planTier !== undefined) data.planTier = p.planTier;
      if (p.billingEmail !== undefined) {
        data.billingEmail = p.billingEmail === "" ? null : p.billingEmail;
      }
      if (p.monthlyMessageQuota !== undefined) data.monthlyMessageQuota = p.monthlyMessageQuota;
      org = await prisma.organization.update({
        where: { id: request.params.id },
        data,
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

  app.delete<{ Params: { id: string } }>("/organizations/:id", async (request, reply) => {
    const orgId = request.params.id;
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }

    const members = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true, role: true, email: true },
    });
    const reassignTo = request.user.id;

    try {
      await prisma.$transaction(async (tx) => {
        for (const u of members) {
          if (u.role === "SUPER_ADMIN") {
            await tx.user.update({
              where: { id: u.id },
              data: { organizationId: null },
            });
            continue;
          }
          await tx.auditLog.updateMany({
            where: { actorUserId: u.id },
            data: { actorUserId: reassignTo },
          });
          await tx.platformApplication.updateMany({
            where: { createdById: u.id },
            data: { createdById: reassignTo },
          });
          await tx.broadcastCampaign.updateMany({
            where: { createdById: u.id },
            data: { createdById: reassignTo },
          });
          await tx.automationKnowledgeRevision.updateMany({
            where: { editorUserId: u.id },
            data: { editorUserId: reassignTo },
          });
          await tx.user.delete({ where: { id: u.id } });
        }
        await tx.organization.delete({ where: { id: orgId } });
      });
    } catch (err) {
      request.log.error(err, "super.organization.delete failed");
      return reply.status(400).send({
        error: "Bad Request",
        message: "Não foi possível eliminar a organização (dependências em uso).",
        statusCode: 400,
      });
    }

    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.organization.delete",
      resourceType: "organization",
      resourceId: orgId,
      metadata: { name: org.name, slug: org.slug },
      ip: clientIp(request),
    });
    return reply.status(204).send();
  });

  app.get("/usage-metrics", async () => {
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows7 = await prisma.$queryRaw<Array<{ organization_id: string; cnt: bigint }>>(
      Prisma.sql`
        SELECT c.organization_id AS organization_id, COUNT(m.id)::bigint AS cnt
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at >= ${since7}
        GROUP BY c.organization_id
      `,
    );
    const rows30 = await prisma.$queryRaw<Array<{ organization_id: string; cnt: bigint }>>(
      Prisma.sql`
        SELECT c.organization_id AS organization_id, COUNT(m.id)::bigint AS cnt
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at >= ${since30}
        GROUP BY c.organization_id
      `,
    );
    const map7 = new Map(rows7.map((r) => [r.organization_id, Number(r.cnt)]));
    const map30 = new Map(rows30.map((r) => [r.organization_id, Number(r.cnt)]));
    const orgList = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true, planTier: true, isActive: true },
      orderBy: { name: "asc" },
    });
    return {
      windows: { shortDays: 7, longDays: 30 },
      organizations: orgList.map((o) => ({
        ...o,
        messagesLast7Days: map7.get(o.id) ?? 0,
        messagesLast30Days: map30.get(o.id) ?? 0,
      })),
    };
  });

  app.get("/users", async (request, reply) => {
    const parsed = superUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const { page, limit, q, organizationId, role, unassigned } = parsed.data;
    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;
    if (organizationId) where.organizationId = organizationId;
    if (unassigned) where.organizationId = null;
    const qTrim = q?.trim();
    if (qTrim) {
      where.OR = [
        { email: { contains: qTrim, mode: "insensitive" } },
        { name: { contains: qTrim, mode: "insensitive" } },
      ];
    }
    const skip = (page - 1) * limit;
    const [total, superAdminTotal, unassignedTotal, data] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({ where: { role: "SUPER_ADMIN" } }),
      prisma.user.count({ where: { organizationId: null, role: { in: ["ADMIN", "AGENT"] } } }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ role: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          organizationId: true,
          organization: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      }),
    ]);
    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: { superAdminTotal, unassignedTotal },
    };
  });

  app.patch<{ Params: { userId: string } }>("/users/:userId", async (request, reply) => {
    const parsed = superPlatformUserPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const target = await prisma.user.findUnique({ where: { id: request.params.userId } });
    if (!target) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }

    const nextRole = parsed.data.role ?? target.role;
    let nextOrgId =
      parsed.data.organizationId !== undefined ? parsed.data.organizationId : target.organizationId;

    if (nextRole === "SUPER_ADMIN") {
      nextOrgId = null;
    } else if (!nextOrgId) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "organizationId is required for ADMIN and AGENT users",
        statusCode: 400,
      });
    }

    if (nextOrgId) {
      const org = await prisma.organization.findUnique({
        where: { id: nextOrgId },
        select: { id: true, isActive: true },
      });
      if (!org) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Organization not found",
          statusCode: 400,
        });
      }
    }

    if (target.role === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN") {
      const superCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
      if (superCount <= 1) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Cannot remove the last Super Admin on the platform",
          statusCode: 400,
        });
      }
    }

    if (parsed.data.email !== undefined && parsed.data.email.toLowerCase() !== target.email.toLowerCase()) {
      const emailTaken = await prisma.user.findFirst({
        where: {
          email: { equals: parsed.data.email, mode: "insensitive" },
          NOT: { id: target.id },
        },
        select: { id: true },
      });
      if (emailTaken) {
        return reply.status(409).send({
          error: "Conflict",
          message: "Email is already in use",
          statusCode: 409,
        });
      }
    }

    const data: {
      name?: string;
      email?: string;
      role?: "SUPER_ADMIN" | "ADMIN" | "AGENT";
      organizationId?: string | null;
    } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.email !== undefined) data.email = parsed.data.email.trim().toLowerCase();
    if (parsed.data.role !== undefined) data.role = parsed.data.role;
    if (parsed.data.role !== undefined || parsed.data.organizationId !== undefined || nextRole === "SUPER_ADMIN") {
      data.organizationId = nextOrgId;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Bad Request", message: "No fields to update", statusCode: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        organizationId: true,
        organization: {
          select: { id: true, name: true, slug: true, isActive: true },
        },
      },
    });

    if (updated.role === "AGENT" && updated.organizationId) {
      await addAgentToAllOrganizationTeams(updated.organizationId, updated.id);
    }

    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: updated.organizationId,
      action: "super.platform_user.update",
      resourceType: "user",
      resourceId: updated.id,
      metadata: { patch: parsed.data, email: updated.email },
      ip: clientIp(request),
    });

    return updated;
  });

  app.delete<{ Params: { userId: string } }>("/users/:userId", async (request, reply) => {
    const target = await prisma.user.findUnique({ where: { id: request.params.userId } });
    if (!target) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }
    if (target.id === request.user.id) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot delete your own account",
        statusCode: 400,
      });
    }
    if (target.role === "SUPER_ADMIN") {
      const superCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
      if (superCount <= 1) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Cannot delete the last Super Admin on the platform",
          statusCode: 400,
        });
      }
    }

    const reassignTo = request.user.id;
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.updateMany({
        where: { actorUserId: target.id },
        data: { actorUserId: reassignTo },
      });
      await tx.platformApplication.updateMany({
        where: { createdById: target.id },
        data: { createdById: reassignTo },
      });
      await tx.broadcastCampaign.updateMany({
        where: { createdById: target.id },
        data: { createdById: reassignTo },
      });
      await tx.automationKnowledgeRevision.updateMany({
        where: { editorUserId: target.id },
        data: { editorUserId: reassignTo },
      });
      await tx.user.delete({ where: { id: target.id } });
    });

    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: target.organizationId,
      action: "super.platform_user.delete",
      resourceType: "user",
      resourceId: target.id,
      metadata: { email: target.email, name: target.name, role: target.role },
      ip: clientIp(request),
    });

    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/organizations/:id/users", async (request, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }
    return prisma.user.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

  app.patch<{ Params: { orgId: string; userId: string } }>(
    "/organizations/:orgId/users/:userId",
    async (request, reply) => {
      const parsed = superUserPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const org = await prisma.organization.findUnique({
        where: { id: request.params.orgId },
        select: { id: true },
      });
      if (!org) {
        return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
      }
      const target = await prisma.user.findFirst({
        where: {
          id: request.params.userId,
          organizationId: org.id,
          role: { in: ["ADMIN", "AGENT"] },
        },
      });
      if (!target) {
        return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
      }
      const data: { name?: string; role?: "ADMIN" | "AGENT" } = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.role !== undefined) data.role = parsed.data.role;
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: "Bad Request", message: "No fields to update", statusCode: 400 });
      }
      const updated = await prisma.user.update({
        where: { id: target.id },
        data,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      if (updated.role === "AGENT") {
        await addAgentToAllOrganizationTeams(org.id, updated.id);
      }
      await safeAudit(request, {
        actorUserId: request.user.id,
        organizationId: org.id,
        action: "super.user.update",
        resourceType: "user",
        resourceId: updated.id,
        metadata: { patch: parsed.data },
        ip: clientIp(request),
      });
      return updated;
    },
  );

  app.post<{ Params: { orgId: string; userId: string } }>(
    "/organizations/:orgId/users/:userId/impersonate",
    async (request, reply) => {
      const org = await prisma.organization.findFirst({
        where: { id: request.params.orgId, isActive: true },
        select: { id: true, name: true },
      });
      if (!org) {
        return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
      }
      const target = await prisma.user.findFirst({
        where: { id: request.params.userId, organizationId: org.id },
      });
      if (!target || target.role === "SUPER_ADMIN") {
        return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
      }
      const token = request.server.jwt.sign({
        id: target.id,
        email: target.email,
        role: target.role,
        organizationId: target.organizationId,
        superAdminActorId: request.user.id,
      });
      await safeAudit(request, {
        actorUserId: request.user.id,
        organizationId: org.id,
        action: "super.user.impersonate.enter",
        resourceType: "user",
        resourceId: target.id,
        metadata: { targetEmail: target.email, organizationName: org.name },
        ip: clientIp(request),
      });
      return { token };
    },
  );

  app.get("/platform-settings", async () => {
    const rows = await prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
    return rows.map((r) => {
      if (r.key === RESEND_EMAIL_PLATFORM_KEY && r.value && typeof r.value === "object" && r.value !== null) {
        const v = { ...(r.value as Record<string, unknown>) };
        if (typeof v.apiKey === "string" && v.apiKey.length > 0) {
          v.apiKey = "••••••••";
        }
        if (typeof v.passwordResetHtmlTemplate === "string" && v.passwordResetHtmlTemplate.length > 0) {
          v.passwordResetHtmlTemplate = `[HTML ${v.passwordResetHtmlTemplate.length} chars — edit in Super admin → Resend]`;
        }
        return { ...r, value: v };
      }
      return r;
    });
  });

  app.put("/platform-settings", async (request, reply) => {
    const parsed = platformSettingUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const row = await prisma.platformSetting.upsert({
      where: { key: parsed.data.key },
      create: { key: parsed.data.key, value: parsed.data.value as Prisma.InputJsonValue },
      update: { value: parsed.data.value as Prisma.InputJsonValue },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.platform_setting.upsert",
      resourceType: "platform_setting",
      resourceId: row.key,
      metadata: { key: row.key },
      ip: clientIp(request),
    });
    return row;
  });

  app.get("/whatsapp-embedded", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: WHATSAPP_EMBEDDED_PLATFORM_KEY },
    });
    const callbackUrl = metaEmbeddedWebhookUrl();
    if (!row?.value || typeof row.value !== "object" || row.value === null) {
      return {
        configured: false,
        appId: "",
        configurationId: "",
        apiVersion: "v22.0",
        webhookVerifyToken: "",
        appSecretMasked: "",
        metaWebhookCallbackUrl: callbackUrl,
      };
    }
    const v = row.value as Record<string, unknown>;
    const appId = String(v.appId ?? "").trim();
    const appSecret = String(v.appSecret ?? "").trim();
    const configurationId = String(v.configurationId ?? "").trim();
    const apiVersion = String(v.apiVersion ?? "v22.0").trim();
    const webhookVerifyToken = String(v.webhookVerifyToken ?? "").trim();
    return {
      configured: !!(appId && appSecret && configurationId && webhookVerifyToken),
      appId,
      configurationId,
      apiVersion: apiVersion || "v22.0",
      webhookVerifyToken,
      appSecretMasked: appSecret ? "••••••••" : "",
      metaWebhookCallbackUrl: callbackUrl,
    };
  });

  app.put("/whatsapp-embedded", async (request, reply) => {
    const parsed = whatsappEmbeddedPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.platformSetting.findUnique({
      where: { key: WHATSAPP_EMBEDDED_PLATFORM_KEY },
    });
    let appSecret = parsed.data.appSecret?.trim() ?? "";
    if (!appSecret && existing?.value && typeof existing.value === "object" && existing.value !== null) {
      appSecret = String((existing.value as Record<string, unknown>).appSecret ?? "").trim();
    }
    if (!appSecret) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "appSecret is required (omit only when updating and secret already stored)",
        statusCode: 400,
      });
    }
    const value = {
      appId: parsed.data.appId.trim(),
      appSecret,
      configurationId: parsed.data.configurationId.trim(),
      apiVersion: parsed.data.apiVersion.trim(),
      webhookVerifyToken: parsed.data.webhookVerifyToken.trim(),
    };
    const row = await prisma.platformSetting.upsert({
      where: { key: WHATSAPP_EMBEDDED_PLATFORM_KEY },
      create: { key: WHATSAPP_EMBEDDED_PLATFORM_KEY, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.whatsapp_embedded.upsert",
      resourceType: "platform_setting",
      resourceId: WHATSAPP_EMBEDDED_PLATFORM_KEY,
      metadata: { appId: value.appId },
      ip: clientIp(request),
    });
    return {
      configured: true,
      appId: value.appId,
      configurationId: value.configurationId,
      apiVersion: value.apiVersion,
      webhookVerifyToken: value.webhookVerifyToken,
      appSecretMasked: "••••••••",
      metaWebhookCallbackUrl: metaEmbeddedWebhookUrl(),
    };
  });

  app.get("/evolution-platform", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: EVOLUTION_PLATFORM_KEY },
    });
    const v = parseEvolutionPlatformValue(row?.value);
    if (!v) {
      return {
        enabled: false,
        tenantQrOnly: false,
        baseUrl: "",
        globalApiKeyMasked: "",
        configured: false,
      };
    }
    return {
      enabled: v.enabled,
      tenantQrOnly: v.tenantQrOnly,
      baseUrl: v.baseUrl,
      globalApiKeyMasked: v.globalApiKey ? "••••••••" : "",
      configured: !!(v.enabled && v.baseUrl && v.globalApiKey),
    };
  });

  app.put("/evolution-platform", async (request, reply) => {
    const parsed = evolutionPlatformPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.platformSetting.findUnique({
      where: { key: EVOLUTION_PLATFORM_KEY },
    });
    let globalApiKey = parsed.data.globalApiKey?.trim() ?? "";
    if (!globalApiKey && existing?.value && typeof existing.value === "object" && existing.value !== null) {
      globalApiKey = String((existing.value as Record<string, unknown>).globalApiKey ?? "").trim();
    }

    const baseUrl = parsed.data.baseUrl.trim();
    if (parsed.data.enabled) {
      if (!baseUrl || !globalApiKey) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "When enabling platform Evolution, baseUrl and globalApiKey are required (omit globalApiKey only to keep the existing key).",
          statusCode: 400,
        });
      }
    }

    const stored = {
      enabled: parsed.data.enabled,
      tenantQrOnly: parsed.data.enabled,
      baseUrl,
      globalApiKey,
    };

    const row = await prisma.platformSetting.upsert({
      where: { key: EVOLUTION_PLATFORM_KEY },
      create: { key: EVOLUTION_PLATFORM_KEY, value: stored as Prisma.InputJsonValue },
      update: { value: stored as Prisma.InputJsonValue },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.evolution_platform.upsert",
      resourceType: "platform_setting",
      resourceId: EVOLUTION_PLATFORM_KEY,
      metadata: { enabled: stored.enabled, tenantQrOnly: stored.tenantQrOnly },
      ip: clientIp(request),
    });
    const v = parseEvolutionPlatformValue(row.value);
    return {
      enabled: v?.enabled ?? false,
      tenantQrOnly: v?.tenantQrOnly ?? false,
      baseUrl: v?.baseUrl ?? "",
      globalApiKeyMasked: v?.globalApiKey ? "••••••••" : "",
      configured: !!(v && v.enabled && v.baseUrl && v.globalApiKey),
    };
  });

  app.get("/evolution-go-platform", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: EVOLUTION_GO_PLATFORM_KEY },
    });
    const v = parseEvolutionGoPlatformValue(row?.value);
    if (!v) {
      return {
        enabled: false,
        baseUrl: "",
        globalApiKeyMasked: "",
        configured: false,
      };
    }
    return {
      enabled: v.enabled,
      baseUrl: v.baseUrl,
      globalApiKeyMasked: v.globalApiKey ? "••••••••" : "",
      configured: !!(v.enabled && v.baseUrl && v.globalApiKey),
    };
  });

  app.put("/evolution-go-platform", async (request, reply) => {
    const parsed = evolutionGoPlatformPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.platformSetting.findUnique({
      where: { key: EVOLUTION_GO_PLATFORM_KEY },
    });
    let globalApiKey = parsed.data.globalApiKey?.trim() ?? "";
    if (!globalApiKey && existing?.value && typeof existing.value === "object" && existing.value !== null) {
      globalApiKey = String((existing.value as Record<string, unknown>).globalApiKey ?? "").trim();
    }

    const baseUrl = parsed.data.baseUrl.trim();
    if (parsed.data.enabled) {
      if (!baseUrl || !globalApiKey) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "When enabling platform Evolution Go, baseUrl and globalApiKey are required (omit globalApiKey only to keep the existing key).",
          statusCode: 400,
        });
      }
    }

    const stored = {
      enabled: parsed.data.enabled,
      baseUrl,
      globalApiKey,
    };

    const row = await prisma.platformSetting.upsert({
      where: { key: EVOLUTION_GO_PLATFORM_KEY },
      create: { key: EVOLUTION_GO_PLATFORM_KEY, value: stored as Prisma.InputJsonValue },
      update: { value: stored as Prisma.InputJsonValue },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.evolution_go_platform.upsert",
      resourceType: "platform_setting",
      resourceId: EVOLUTION_GO_PLATFORM_KEY,
      metadata: { enabled: stored.enabled },
      ip: clientIp(request),
    });
    const v = parseEvolutionGoPlatformValue(row.value);
    return {
      enabled: v?.enabled ?? false,
      baseUrl: v?.baseUrl ?? "",
      globalApiKeyMasked: v?.globalApiKey ? "••••••••" : "",
      configured: !!(v && v.enabled && v.baseUrl && v.globalApiKey),
    };
  });

  app.get("/resend-email", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: RESEND_EMAIL_PLATFORM_KEY },
    });
    const tpl = getPasswordResetTemplatesForEditor(row?.value);
    const inviteTpl = getUserInviteTemplatesForEditor(row?.value);
    const rawVal =
      row?.value && typeof row.value === "object" && row.value !== null
        ? (row.value as Record<string, unknown>)
        : {};
    const systemLogoUrl =
      typeof rawVal.systemLogoUrl === "string" && rawVal.systemLogoUrl.trim() ? rawVal.systemLogoUrl.trim() : "";
    const parsed = parseResendEmailValue(row?.value);
    if (!parsed) {
      return {
        configured: false,
        fromEmail: "",
        fromName: "OpenNexo CRM",
        apiKeyMasked: "",
        systemLogoUrl,
        passwordResetSubject: tpl.subject,
        passwordResetHtmlTemplate: tpl.html,
        userInviteSubject: inviteTpl.subject,
        userInviteHtmlTemplate: inviteTpl.html,
      };
    }
    return {
      configured: true,
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName,
      apiKeyMasked: "••••••••",
      systemLogoUrl: parsed.systemLogoUrl ?? systemLogoUrl,
      passwordResetSubject: tpl.subject,
      passwordResetHtmlTemplate: tpl.html,
      userInviteSubject: inviteTpl.subject,
      userInviteHtmlTemplate: inviteTpl.html,
    };
  });

  app.put("/resend-email", async (request, reply) => {
    const parsed = resendEmailPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.platformSetting.findUnique({
      where: { key: RESEND_EMAIL_PLATFORM_KEY },
    });
    let apiKey = parsed.data.apiKey?.trim() ?? "";
    if (!apiKey && existing?.value && typeof existing.value === "object" && existing.value !== null) {
      apiKey = String((existing.value as Record<string, unknown>).apiKey ?? "").trim();
    }
    if (!apiKey) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "apiKey is required (omit only when updating and a key is already stored)",
        statusCode: 400,
      });
    }
    const fromName = (parsed.data.fromName?.trim() || "OpenNexo CRM").slice(0, 120);
    const existingVal =
      existing?.value && typeof existing.value === "object" && existing.value !== null
        ? (existing.value as Record<string, unknown>)
        : {};
    const passwordResetSubject =
      parsed.data.passwordResetSubject !== undefined
        ? parsed.data.passwordResetSubject.trim().slice(0, 200) || null
        : (typeof existingVal.passwordResetSubject === "string" ? existingVal.passwordResetSubject : null) ??
          null;
    const passwordResetHtmlTemplate =
      parsed.data.passwordResetHtmlTemplate !== undefined
        ? parsed.data.passwordResetHtmlTemplate.trim().slice(0, 100_000) || null
        : (typeof existingVal.passwordResetHtmlTemplate === "string"
            ? existingVal.passwordResetHtmlTemplate
            : null) ?? null;
    const systemLogoUrl =
      parsed.data.systemLogoUrl !== undefined
        ? parsed.data.systemLogoUrl.trim().slice(0, 2000) || null
        : (typeof existingVal.systemLogoUrl === "string" ? existingVal.systemLogoUrl : null) ?? null;
    const userInviteSubject =
      parsed.data.userInviteSubject !== undefined
        ? parsed.data.userInviteSubject.trim().slice(0, 200) || null
        : (typeof existingVal.userInviteSubject === "string" ? existingVal.userInviteSubject : null) ?? null;
    const userInviteHtmlTemplate =
      parsed.data.userInviteHtmlTemplate !== undefined
        ? parsed.data.userInviteHtmlTemplate.trim().slice(0, 100_000) || null
        : (typeof existingVal.userInviteHtmlTemplate === "string"
            ? existingVal.userInviteHtmlTemplate
            : null) ?? null;
    const value = {
      apiKey,
      fromEmail: parsed.data.fromEmail.trim().toLowerCase(),
      fromName,
      systemLogoUrl,
      passwordResetSubject,
      passwordResetHtmlTemplate,
      userInviteSubject,
      userInviteHtmlTemplate,
    };
    await prisma.platformSetting.upsert({
      where: { key: RESEND_EMAIL_PLATFORM_KEY },
      create: { key: RESEND_EMAIL_PLATFORM_KEY, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.resend_email.upsert",
      resourceType: "platform_setting",
      resourceId: RESEND_EMAIL_PLATFORM_KEY,
      metadata: { fromEmail: value.fromEmail },
      ip: clientIp(request),
    });
    const tpl = getPasswordResetTemplatesForEditor(value);
    const inviteTpl = getUserInviteTemplatesForEditor(value);
    return {
      configured: true,
      fromEmail: value.fromEmail,
      fromName: value.fromName,
      apiKeyMasked: "••••••••",
      systemLogoUrl: value.systemLogoUrl ?? "",
      passwordResetSubject: tpl.subject,
      passwordResetHtmlTemplate: tpl.html,
      userInviteSubject: inviteTpl.subject,
      userInviteHtmlTemplate: inviteTpl.html,
    };
  });

  app.get("/media-storage", async () => {
    const row = await prisma.platformSetting.findUnique({
      where: { key: MEDIA_STORAGE_PLATFORM_KEY },
    });
    const parsed = parseMediaStoragePlatformValue(row?.value);
    const envDriver = config.mediaStorageDriver.trim().toLowerCase() === "minio" ? "minio" : "local";
    if (!parsed) {
      return {
        configured: false,
        enabled: false,
        driver: envDriver,
        endpoint: config.minioEndpoint,
        bucket: config.minioBucket,
        accessKeyMasked: config.minioAccessKey ? "••••••••" : "",
        secretKeyMasked: config.minioSecretKey ? "••••••••" : "",
        useSsl: config.minioUseSsl,
        region: config.minioRegion,
        publicBaseUrl: config.minioPublicBaseUrl,
        source: "env",
      };
    }
    return {
      configured: parsed.enabled && (parsed.driver === "local" || !!(parsed.endpoint && parsed.bucket)),
      enabled: parsed.enabled,
      driver: parsed.driver,
      endpoint: parsed.endpoint ?? "",
      bucket: parsed.bucket ?? "",
      accessKeyMasked: parsed.accessKey ? "••••••••" : "",
      secretKeyMasked: parsed.secretKey ? "••••••••" : "",
      useSsl: parsed.useSsl === true,
      region: parsed.region ?? "us-east-1",
      publicBaseUrl: parsed.publicBaseUrl ?? "",
      source: "platform",
    };
  });

  app.put("/media-storage", async (request, reply) => {
    const parsed = mediaStoragePutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.platformSetting.findUnique({
      where: { key: MEDIA_STORAGE_PLATFORM_KEY },
    });
    const existingVal =
      existing?.value && typeof existing.value === "object" && existing.value !== null
        ? (existing.value as Record<string, unknown>)
        : {};

    if (!parsed.data.enabled) {
      const value = { enabled: false, driver: "local" as const };
      await prisma.platformSetting.upsert({
        where: { key: MEDIA_STORAGE_PLATFORM_KEY },
        create: { key: MEDIA_STORAGE_PLATFORM_KEY, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
      invalidateMediaStorageCache();
      await safeAudit(request, {
        actorUserId: request.user.id,
        action: "super.media_storage.upsert",
        resourceType: "platform_setting",
        resourceId: MEDIA_STORAGE_PLATFORM_KEY,
        metadata: { enabled: false, driver: "local" },
        ip: clientIp(request),
      });
      return {
        configured: false,
        enabled: false,
        driver: "local",
        endpoint: "",
        bucket: "",
        accessKeyMasked: "",
        secretKeyMasked: "",
        useSsl: false,
        region: "us-east-1",
        publicBaseUrl: "",
        source: "platform",
      };
    }

    if (parsed.data.driver === "local") {
      const value = { enabled: true, driver: "local" as const };
      await prisma.platformSetting.upsert({
        where: { key: MEDIA_STORAGE_PLATFORM_KEY },
        create: { key: MEDIA_STORAGE_PLATFORM_KEY, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
      invalidateMediaStorageCache();
      await safeAudit(request, {
        actorUserId: request.user.id,
        action: "super.media_storage.upsert",
        resourceType: "platform_setting",
        resourceId: MEDIA_STORAGE_PLATFORM_KEY,
        metadata: { enabled: true, driver: "local" },
        ip: clientIp(request),
      });
      return {
        configured: true,
        enabled: true,
        driver: "local",
        endpoint: "",
        bucket: "",
        accessKeyMasked: "",
        secretKeyMasked: "",
        useSsl: false,
        region: "us-east-1",
        publicBaseUrl: "",
        source: "platform",
      };
    }

    const endpoint = (parsed.data.endpoint ?? "").trim();
    const bucket = (parsed.data.bucket ?? "").trim();
    let accessKey = (parsed.data.accessKey ?? "").trim();
    let secretKey = (parsed.data.secretKey ?? "").trim();
    if (!accessKey) accessKey = String(existingVal.accessKey ?? "").trim();
    if (!secretKey) secretKey = String(existingVal.secretKey ?? "").trim();
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "endpoint, bucket, accessKey and secretKey are required for MinIO",
        statusCode: 400,
      });
    }

    const value = {
      enabled: true,
      driver: "minio" as const,
      endpoint,
      bucket,
      accessKey,
      secretKey,
      useSsl: parsed.data.useSsl === true,
      region: (parsed.data.region?.trim() || "us-east-1").slice(0, 64),
      publicBaseUrl: (parsed.data.publicBaseUrl ?? "").trim().replace(/\/+$/, "") || null,
    };
    await prisma.platformSetting.upsert({
      where: { key: MEDIA_STORAGE_PLATFORM_KEY },
      create: { key: MEDIA_STORAGE_PLATFORM_KEY, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    invalidateMediaStorageCache();
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.media_storage.upsert",
      resourceType: "platform_setting",
      resourceId: MEDIA_STORAGE_PLATFORM_KEY,
      metadata: { enabled: true, driver: "minio", bucket, endpoint },
      ip: clientIp(request),
    });
    return {
      configured: true,
      enabled: true,
      driver: "minio",
      endpoint,
      bucket,
      accessKeyMasked: "••••••••",
      secretKeyMasked: "••••••••",
      useSsl: value.useSsl,
      region: value.region,
      publicBaseUrl: value.publicBaseUrl ?? "",
      source: "platform",
    };
  });

  app.get("/conversation-media/stats", async (request, reply) => {
    const q = conversationMediaQuerySchema
      .pick({ q: true, storage: true, organizationId: true, type: true, month: true, day: true })
      .safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ error: "Bad Request", message: q.error.message, statusCode: 400 });
    }
    const items = await buildConversationMediaInventory();
    const filtered = filterConversationMediaInventory(items, {
      page: 1,
      limit: 1,
      q: q.data.q,
      storage: q.data.storage ?? "all",
      organizationId: q.data.organizationId,
      type: q.data.type,
      month: q.data.month,
      day: q.data.day,
    });
    return getConversationMediaInventoryStats(filtered);
  });

  app.get("/conversation-media/by-organization", async (request, reply) => {
    const q = conversationMediaQuerySchema
      .pick({ q: true, storage: true, type: true, month: true, day: true })
      .safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ error: "Bad Request", message: q.error.message, statusCode: 400 });
    }
    const items = await buildConversationMediaInventory();
    const filtered = filterConversationMediaInventory(items, {
      page: 1,
      limit: 1,
      q: q.data.q,
      storage: q.data.storage ?? "all",
      type: q.data.type,
      month: q.data.month,
      day: q.data.day,
    });
    return { data: summarizeConversationMediaByOrganization(filtered) };
  });

  app.get("/conversation-media/retention", async () => {
    return getConversationMediaRetentionFromDb();
  });

  app.put("/conversation-media/retention", async (request, reply) => {
    const parsed = conversationMediaRetentionPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const current = await getConversationMediaRetentionFromDb();
    const value = await saveConversationMediaRetentionValue({
      ...current,
      enabled: parsed.data.enabled,
      retentionMonths: parsed.data.retentionMonths as ConversationMediaRetentionMonths,
    });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.conversation_media.retention_update",
      resourceType: "platform_setting",
      resourceId: "conversation_media_retention",
      metadata: { enabled: value.enabled, retentionMonths: value.retentionMonths },
      ip: clientIp(request),
    });
    return value;
  });

  app.post("/conversation-media/retention/run", async (request) => {
    const result = await runConversationMediaRetentionTick({ force: true });
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.conversation_media.retention_run",
      resourceType: "platform_setting",
      resourceId: "conversation_media_retention",
      metadata: result ?? { deletedFiles: 0, clearedReferences: 0 },
      ip: clientIp(request),
    });
    return result ?? { deletedFiles: 0, clearedReferences: 0, skipped: true };
  });

  app.get("/conversation-media", async (request, reply) => {
    const parsed = conversationMediaQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const items = await buildConversationMediaInventory();
    const filtered = filterConversationMediaInventory(items, {
      page: parsed.data.page,
      limit: parsed.data.limit,
      q: parsed.data.q,
      storage: parsed.data.storage ?? "all",
      organizationId: parsed.data.organizationId,
      type: parsed.data.type,
      month: parsed.data.month,
      day: parsed.data.day,
    });
    const page = paginateConversationMediaInventory(filtered, parsed.data.page, parsed.data.limit);
    return page;
  });

  app.delete<{ Params: { filename: string } }>("/conversation-media/:filename", async (request, reply) => {
    const filename = request.params.filename;
    if (!MESSAGE_MEDIA_FILENAME_RE.test(filename)) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid filename", statusCode: 400 });
    }
    const result = await deleteConversationMediaFiles([filename]);
    if (result.deleted.length === 0 && result.errors.length > 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: result.errors[0]?.message ?? "Delete failed",
        statusCode: 400,
      });
    }
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.conversation_media.delete",
      resourceType: "message_media",
      resourceId: filename,
      metadata: {
        deleted: result.deleted,
        clearedDbReferences: result.clearedDbReferences,
      },
      ip: clientIp(request),
    });
    return result;
  });

  app.post("/conversation-media/bulk-delete", async (request, reply) => {
    const parsed = conversationMediaBulkDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const result = await deleteConversationMediaFiles(parsed.data.filenames);
    await safeAudit(request, {
      actorUserId: request.user.id,
      action: "super.conversation_media.bulk_delete",
      resourceType: "message_media",
      resourceId: "bulk",
      metadata: {
        requested: parsed.data.filenames.length,
        deleted: result.deleted.length,
        clearedDbReferences: result.clearedDbReferences,
        errors: result.errors,
      },
      ip: clientIp(request),
    });
    return result;
  });
}
