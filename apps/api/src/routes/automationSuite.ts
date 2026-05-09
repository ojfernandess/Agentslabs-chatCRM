import { createHash } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { recordAuditLog, clientIp } from "../lib/audit.js";
import { AUTOMATION_TOOL_PRESETS, getPresetByKey } from "../lib/automationToolPresets.js";
import { assertHttpUrlAllowed, truncateBody } from "../lib/httpToolTest.js";
import { redactAutomationToolConfig } from "../lib/automationWebhookBundle.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

function redactLlmConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  const c = { ...(config as Record<string, unknown>) };
  if ("apiKey" in c && c.apiKey) c.apiKey = "***";
  return c;
}

const defaultLlmConfig = () => ({
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 1024,
  apiBaseUrl: null as string | null,
  apiKey: null as string | null,
});

const defaultBehaviorConfig = () => ({
  nativeTools: {
    knowledge_search: true,
    call_human: true,
    end_conversation: false,
    list_teams: false,
    list_pipeline_stages: false,
    assign_team_to_conversation: false,
    set_conversation_status: false,
    list_google_calendars: false,
    scheduling_google: false,
    scheduling_outlook: false,
    ping: false,
  },
  escalationRules: {
    conditions: "",
    transferMessage: "",
    mode: "keyword" as string,
    keywords: "" as string,
  },
  inactivity: {
    automationEnabled: false,
    timeoutMinutes: 30,
    followUpMax: 0,
    followUpMessages: [] as string[],
    followUpMessage: "" as string,
    pauseMessage: "",
    closeMessage: "",
    clearContextAfterFollowUpMinutes: null as number | null,
  },
  voice: {
    elevenLabsEnabled: false,
    elevenLabsToolId: null as string | null,
    voiceResponsePercent: 100,
    voiceId: null as string | null,
    replyWithAudioOnInboundAudio: false,
  },
  scheduling: { useOrgReminders: true, externalCalendar: "none" as string },
  connectedTools: [] as Array<Record<string, unknown>>,
});

function deriveBotAutomationSource(bot: { webhookUrl: string | null; config: unknown }): {
  editInExternalAutomation: boolean;
  managedByOpenConduit: boolean;
} {
  const cfg = bot.config && typeof bot.config === "object" ? (bot.config as Record<string, unknown>) : {};
  const managedByOpenConduit = cfg.automationManagedByOpenConduit === true;
  const hasOutboundWebhook = Boolean(bot.webhookUrl?.trim());
  return {
    managedByOpenConduit,
    editInExternalAutomation: hasOutboundWebhook && !managedByOpenConduit,
  };
}

const knowledgeCreateSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  category: z.string().max(120).optional().nullable(),
  tags: z.array(z.string().max(64)).optional().default([]),
  isActive: z.boolean().optional(),
  syncToAi: z.boolean().optional(),
  botIds: z.array(z.string().uuid()).optional().default([]),
});

const knowledgePatchSchema = knowledgeCreateSchema.partial();

const promptModuleSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/),
  body: z.string().min(1),
  version: z.number().int().min(1).optional(),
  labels: z.record(z.unknown()).optional().nullable(),
});

const customToolSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1),
  toolType: z.string().min(1).max(64),
  config: z.record(z.unknown()),
  parametersSchema: z.record(z.unknown()),
  isActive: z.boolean().optional(),
  botId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(48)).max(32).optional(),
});

function redactToolRow<T extends { config: unknown }>(row: T): T {
  return { ...row, config: redactAutomationToolConfig(row.config) } as T;
}

function mergeToolConfig(existing: unknown, incoming: unknown): Record<string, unknown> {
  const e = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  const i = incoming && typeof incoming === "object" ? { ...(incoming as Record<string, unknown>) } : {};
  const out: Record<string, unknown> = { ...e, ...i };
  for (const k of Object.keys(out)) {
    if (out[k] === "***") delete out[k];
  }
  return out;
}

const interactionCreateSchema = z.object({
  botId: z.string().uuid(),
  conversationId: z.string().uuid().optional().nullable(),
  userMessage: z.string().min(1),
  assistantMessage: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  knowledgeArticleIds: z.array(z.string().uuid()).optional(),
  escalatedToHuman: z.boolean().optional(),
  responseType: z.string().max(32).optional(),
});

const KB_CACHE_TTL_MS = 60 * 60 * 1000;

export async function automationSuiteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/dashboard", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const [
      knowledgeCount,
      agentsWithProfile,
      interactionsToday,
      recentInteractions,
      escalationsToday,
    ] = await Promise.all([
      prisma.automationKnowledgeArticle.count({ where: { organizationId } }),
      prisma.automationAgentProfile.count({ where: { organizationId } }),
      prisma.automationInteraction.count({
        where: { organizationId, createdAt: { gte: start } },
      }),
      prisma.automationInteraction.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          botId: true,
          conversationId: true,
          userMessage: true,
          assistantMessage: true,
          escalatedToHuman: true,
          responseType: true,
          createdAt: true,
          bot: { select: { name: true } },
        },
      }),
      prisma.automationInteraction.count({
        where: { organizationId, escalatedToHuman: true, createdAt: { gte: start } },
      }),
    ]);

    const activeBots = await prisma.bot.count({ where: { organizationId, isActive: true } });

    return {
      counts: {
        knowledgeArticles: knowledgeCount,
        agentProfiles: agentsWithProfile,
        activeBots,
        interactionsToday,
        escalationsToday,
      },
      recentInteractions,
    };
  });

  app.get("/knowledge-articles", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const rows = await prisma.automationKnowledgeArticle.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      include: { botLinks: { select: { botId: true } } },
    });
    return {
      data: rows.map((r) => ({
        ...r,
        botIds: r.botLinks.map((l) => l.botId),
        botLinks: undefined,
      })),
    };
  });

  app.post("/knowledge-articles", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = knowledgeCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const botIds = parsed.data.botIds ?? [];
    if (botIds.length > 0) {
      const n = await prisma.bot.count({ where: { organizationId, id: { in: botIds } } });
      if (n !== botIds.length) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botIds", statusCode: 400 });
      }
    }

    const row = await prisma.automationKnowledgeArticle.create({
      data: {
        organizationId,
        title: parsed.data.title,
        content: parsed.data.content,
        category: parsed.data.category ?? null,
        tags: parsed.data.tags ?? [],
        isActive: parsed.data.isActive ?? true,
        syncToAi: parsed.data.syncToAi ?? true,
        botLinks: botIds.length ? { create: botIds.map((botId) => ({ botId })) } : undefined,
      },
      include: { botLinks: { select: { botId: true } } },
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge.create",
      resourceType: "automation_knowledge_article",
      resourceId: row.id,
      ip: clientIp(request),
    });

    return { ...row, botIds: row.botLinks.map((l) => l.botId) };
  });

  app.patch<{ Params: { id: string } }>("/knowledge-articles/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = knowledgePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.automationKnowledgeArticle.findFirst({
      where: { id: request.params.id, organizationId },
      include: { botLinks: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Article not found", statusCode: 404 });
    }

    await prisma.automationKnowledgeRevision.create({
      data: {
        articleId: existing.id,
        editorUserId: request.user.id,
        snapshot: {
          title: existing.title,
          content: existing.content,
          category: existing.category,
          tags: existing.tags,
          isActive: existing.isActive,
          syncToAi: existing.syncToAi,
        },
      },
    });

    const botIds = parsed.data.botIds;
    if (botIds !== undefined) {
      const uniq = [...new Set(botIds)];
      if (uniq.length > 0) {
        const n = await prisma.bot.count({ where: { organizationId, id: { in: uniq } } });
        if (n !== uniq.length) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid botIds", statusCode: 400 });
        }
      }
    }

    const updateData: {
      title?: string;
      content?: string;
      category?: string | null;
      tags?: string[];
      isActive?: boolean;
      syncToAi?: boolean;
    } = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category ?? null;
    if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.syncToAi !== undefined) updateData.syncToAi = parsed.data.syncToAi;

    const row = await prisma.$transaction(async (tx) => {
      if (botIds !== undefined) {
        await tx.automationKnowledgeArticleBot.deleteMany({ where: { articleId: existing.id } });
        if (botIds.length > 0) {
          await tx.automationKnowledgeArticleBot.createMany({
            data: botIds.map((botId) => ({ articleId: existing.id, botId })),
          });
        }
      }
      return tx.automationKnowledgeArticle.update({
        where: { id: existing.id },
        data: updateData,
        include: { botLinks: { select: { botId: true } } },
      });
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge.update",
      resourceType: "automation_knowledge_article",
      resourceId: row.id,
      ip: clientIp(request),
    });

    return { ...row, botIds: row.botLinks.map((l) => l.botId) };
  });

  app.delete<{ Params: { id: string } }>("/knowledge-articles/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.automationKnowledgeArticle.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Article not found", statusCode: 404 });
    }
    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge.delete",
      resourceType: "automation_knowledge_article",
      resourceId: request.params.id,
      ip: clientIp(request),
    });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/knowledge-articles/:id/revisions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const article = await prisma.automationKnowledgeArticle.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!article) {
      return reply.status(404).send({ error: "Not Found", message: "Article not found", statusCode: 404 });
    }
    const revs = await prisma.automationKnowledgeRevision.findMany({
      where: { articleId: article.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { editor: { select: { id: true, name: true } } },
    });
    return { data: revs };
  });

  const searchBodySchema = z.object({
    query: z.string().min(1).max(500),
    botId: z.string().uuid().optional(),
  });

  app.post("/knowledge-articles/search", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const parsed = searchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const norm = parsed.data.query.trim().toLowerCase().slice(0, 500);
    const hash = createHash("sha256").update(`${organizationId}:${norm}`).digest("hex");
    const now = new Date();

    const cached = await prisma.kbSearchCache.findUnique({
      where: { organizationId_queryHash: { organizationId, queryHash: hash } },
    });
    if (cached?.expiresAt && cached.expiresAt > now) {
      await prisma.kbSearchCache.update({
        where: { id: cached.id },
        data: { hitCount: { increment: 1 } },
      });
      const ids = cached.articleIds as string[];
      const articles = await prisma.automationKnowledgeArticle.findMany({
        where: { id: { in: ids }, organizationId },
      });
      await prisma.kbSearchLog.create({
        data: {
          organizationId,
          queryNormalized: norm,
          resultsCount: articles.length,
          actorUserId: request.user.id,
        },
      });
      return { cached: true, data: articles };
    }

    const whereBase = {
      organizationId,
      isActive: true,
      syncToAi: true,
      OR: [
        { title: { contains: norm, mode: "insensitive" as const } },
        { content: { contains: norm, mode: "insensitive" as const } },
      ],
    };

    const where =
      parsed.data.botId != null
        ? { ...whereBase, botLinks: { some: { botId: parsed.data.botId } } }
        : whereBase;

    const articles = await prisma.automationKnowledgeArticle.findMany({
      where,
      take: 25,
      orderBy: { updatedAt: "desc" },
    });

    const articleIds = articles.map((a) => a.id);
    const exp = new Date(Date.now() + KB_CACHE_TTL_MS);
    await prisma.kbSearchCache.upsert({
      where: { organizationId_queryHash: { organizationId, queryHash: hash } },
      create: {
        organizationId,
        queryHash: hash,
        articleIds,
        expiresAt: exp,
      },
      update: {
        articleIds,
        expiresAt: exp,
        hitCount: { increment: 1 },
      },
    });

    await prisma.kbSearchLog.create({
      data: {
        organizationId,
        queryNormalized: norm,
        resultsCount: articles.length,
        actorUserId: request.user.id,
      },
    });

    return { cached: false, data: articles };
  });

  app.get("/prompt-modules", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const data = await prisma.automationPromptModule.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
    return { data };
  });

  app.post("/prompt-modules", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = promptModuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    try {
      const row = await prisma.automationPromptModule.create({
        data: {
          organizationId,
          name: parsed.data.name,
          slug: parsed.data.slug,
          body: parsed.data.body,
          version: parsed.data.version ?? 1,
          labels: parsed.data.labels == null ? undefined : asJson(parsed.data.labels),
        },
      });
      return row;
    } catch {
      return reply.status(409).send({ error: "Conflict", message: "Slug already exists", statusCode: 409 });
    }
  });

  app.patch<{ Params: { id: string } }>("/prompt-modules/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = promptModuleSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    try {
      const data: Prisma.AutomationPromptModuleUpdateInput = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.slug !== undefined) data.slug = parsed.data.slug;
      if (parsed.data.body !== undefined) data.body = parsed.data.body;
      if (parsed.data.version !== undefined) data.version = parsed.data.version;
      if (parsed.data.labels !== undefined) {
        data.labels = parsed.data.labels == null ? Prisma.JsonNull : asJson(parsed.data.labels);
      }
      const row = await prisma.automationPromptModule.updateMany({
        where: { id: request.params.id, organizationId },
        data,
      });
      if (row.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Module not found", statusCode: 404 });
      }
      return prisma.automationPromptModule.findFirst({
        where: { id: request.params.id, organizationId },
      });
    } catch {
      return reply.status(409).send({ error: "Conflict", message: "Slug conflict", statusCode: 409 });
    }
  });

  app.delete<{ Params: { id: string } }>("/prompt-modules/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.automationPromptModule.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Module not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.get("/tool-presets", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    return {
      data: AUTOMATION_TOOL_PRESETS.map((p) => ({
        presetKey: p.presetKey,
        category: p.category,
        name: p.name,
        description: p.description,
        toolType: p.toolType,
        parametersSchema: p.parametersSchema,
        marketplace: p.marketplace ?? null,
      })),
    };
  });

  app.get("/custom-tools", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const data = await prisma.automationCustomTool.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
    return { data: data.map((r) => redactToolRow(r)) };
  });

  const fromPresetSchema = z.object({
    presetKey: z.string().min(1).max(64),
    botId: z.string().uuid().nullable().optional(),
  });

  app.post("/custom-tools/from-preset", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = fromPresetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const def = getPresetByKey(parsed.data.presetKey);
    if (!def) {
      return reply.status(404).send({ error: "Not Found", message: "Unknown preset", statusCode: 404 });
    }
    if (parsed.data.botId) {
      const b = await prisma.bot.findFirst({
        where: { id: parsed.data.botId, organizationId },
      });
      if (!b) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botId", statusCode: 400 });
      }
    }
    const existingAll = await prisma.automationCustomTool.findMany({ where: { organizationId } });
    const existing = existingAll.find((r) => {
      const c = r.config as Record<string, unknown> | null;
      return c && typeof c === "object" && c.presetKey === def.presetKey;
    });
    if (existing) {
      return reply.status(200).send(redactToolRow(existing));
    }
    const row = await prisma.automationCustomTool.create({
      data: {
        organizationId,
        botId: parsed.data.botId ?? null,
        name: def.name,
        description: def.description,
        toolType: def.toolType,
        config: asJson(def.defaultConfig),
        parametersSchema: asJson(def.parametersSchema),
        isActive: true,
      },
    });
    return reply.status(201).send(redactToolRow(row));
  });

  app.post("/custom-tools", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = customToolSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    if (parsed.data.botId) {
      const b = await prisma.bot.findFirst({
        where: { id: parsed.data.botId, organizationId },
      });
      if (!b) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botId", statusCode: 400 });
      }
    }
    const row = await prisma.automationCustomTool.create({
      data: {
        organizationId,
        botId: parsed.data.botId ?? null,
        name: parsed.data.name,
        description: parsed.data.description,
        toolType: parsed.data.toolType,
        config: asJson(parsed.data.config),
        parametersSchema: asJson(parsed.data.parametersSchema),
        isActive: parsed.data.isActive ?? true,
        tags: parsed.data.tags ?? [],
      },
    });
    return redactToolRow(row);
  });

  app.patch<{ Params: { id: string } }>("/custom-tools/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = customToolSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    if (parsed.data.botId) {
      const b = await prisma.bot.findFirst({
        where: { id: parsed.data.botId, organizationId },
      });
      if (!b) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botId", statusCode: 400 });
      }
    }
    try {
      const current = await prisma.automationCustomTool.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!current) {
        return reply.status(404).send({ error: "Not Found", message: "Tool not found", statusCode: 404 });
      }
      const data: Prisma.AutomationCustomToolUncheckedUpdateInput = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.description !== undefined) data.description = parsed.data.description;
      if (parsed.data.toolType !== undefined) data.toolType = parsed.data.toolType;
      if (parsed.data.config !== undefined) {
        data.config = asJson(mergeToolConfig(current.config, parsed.data.config));
      }
      if (parsed.data.parametersSchema !== undefined) data.parametersSchema = asJson(parsed.data.parametersSchema);
      if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
      if (parsed.data.botId !== undefined) data.botId = parsed.data.botId;
      if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;
      await prisma.automationCustomTool.update({
        where: { id: current.id },
        data,
      });
      const updated = await prisma.automationCustomTool.findFirst({
        where: { id: request.params.id, organizationId },
      });
      return updated ? redactToolRow(updated) : null;
    } catch (e) {
      return reply.status(400).send({ error: "Bad Request", message: String(e), statusCode: 400 });
    }
  });

  app.delete<{ Params: { id: string } }>("/custom-tools/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.automationCustomTool.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Tool not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  function flattenTemplateContext(obj: unknown, prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(out, flattenTemplateContext(v, p));
        } else if (v !== undefined && v !== null) {
          out[p] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
        }
      }
    }
    return out;
  }

  function expandTemplateString(template: string, flat: Record<string, string>): string {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
      const key = rawKey.trim();
      return flat[key] ?? "";
    });
  }

  const toolTestBodySchema = z.object({
    pathParams: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    sampleContext: z.record(z.unknown()).optional(),
  });

  app.get<{ Params: { id: string } }>("/custom-tools/:id/executions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const tool = await prisma.automationCustomTool.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!tool) {
      return reply.status(404).send({ error: "Not Found", message: "Tool not found", statusCode: 404 });
    }
    const limit = Math.min(100, Math.max(1, Number((request.query as { limit?: string }).limit) || 50));
    const rows = await prisma.automationToolExecution.findMany({
      where: { toolId: tool.id, organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { data: rows };
  });

  app.post<{ Params: { id: string } }>(
    "/custom-tools/:id/test",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const parsed = toolTestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const tool = await prisma.automationCustomTool.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!tool) {
        return reply.status(404).send({ error: "Not Found", message: "Tool not found", statusCode: 404 });
      }
      if (!tool.isActive) {
        return reply.status(400).send({ error: "Bad Request", message: "Tool is inactive", statusCode: 400 });
      }
      if (tool.toolType !== "HTTP_API" && tool.toolType !== "WEBHOOK") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Test runner supports HTTP_API and WEBHOOK tools only",
          statusCode: 400,
        });
      }

      const cfg = tool.config && typeof tool.config === "object" ? (tool.config as Record<string, unknown>) : {};
      const flat = flattenTemplateContext(parsed.data.sampleContext ?? {});

      let method = String(cfg.httpMethod ?? "GET").toUpperCase();
      let pathPart = expandTemplateString(String(cfg.httpPath ?? "/"), flat);
      let base = String(cfg.baseUrl ?? "").replace(/\/$/, "");
      let fullUrlStr = "";

      if (tool.toolType === "WEBHOOK") {
        const wUrl = expandTemplateString(String(cfg.webhookUrl ?? ""), flat);
        if (!wUrl.trim()) {
          return reply.status(400).send({ error: "Bad Request", message: "webhookUrl is not configured", statusCode: 400 });
        }
        fullUrlStr = wUrl;
        method = String(cfg.httpMethod ?? "POST").toUpperCase();
      } else {
        if (!base) {
          return reply.status(400).send({ error: "Bad Request", message: "baseUrl is not configured", statusCode: 400 });
        }
        const pathParams = parsed.data.pathParams ?? {};
        for (const [pk, pv] of Object.entries(pathParams)) {
          pathPart = pathPart.split(`{${pk}}`).join(encodeURIComponent(pv));
        }
        pathPart = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
        fullUrlStr = `${base}${pathPart}`;
      }

      const url = assertHttpUrlAllowed(fullUrlStr);
      if (parsed.data.query) {
        for (const [qk, qv] of Object.entries(parsed.data.query)) {
          url.searchParams.set(qk, qv);
        }
      }
      const defaultQuery = cfg.defaultQuery && typeof cfg.defaultQuery === "object" ? (cfg.defaultQuery as Record<string, unknown>) : {};
      for (const [qk, qv] of Object.entries(defaultQuery)) {
        if (typeof qv === "string" || typeof qv === "number" || typeof qv === "boolean") {
          if (!url.searchParams.has(qk)) url.searchParams.set(qk, String(qv));
        }
      }

      const headers = new Headers();
      const defaultHeaders =
        cfg.defaultHeaders && typeof cfg.defaultHeaders === "object" ? (cfg.defaultHeaders as Record<string, unknown>) : {};
      for (const [hk, hv] of Object.entries(defaultHeaders)) {
        if (typeof hv === "string") headers.set(hk, expandTemplateString(hv, flat));
      }
      if (parsed.data.headers) {
        for (const [hk, hv] of Object.entries(parsed.data.headers)) {
          headers.set(hk, expandTemplateString(hv, flat));
        }
      }

      const authType = String(cfg.authType ?? "none");
      if (authType === "bearer" || authType === "bearer_token") {
        const tok = String(cfg.bearerToken ?? "");
        if (tok) headers.set("Authorization", `Bearer ${tok}`);
      } else if (authType === "api_key") {
        const hName = String(cfg.apiKeyHeader ?? "X-Api-Key");
        const hVal = String(cfg.apiKeyValue ?? "");
        if (hVal) headers.set(hName, hVal);
      } else if (authType === "basic") {
        const u = String(cfg.basicUser ?? "");
        const p = String(cfg.basicPassword ?? "");
        if (u || p) {
          const b64 = Buffer.from(`${u}:${p}`).toString("base64");
          headers.set("Authorization", `Basic ${b64}`);
        }
      } else if (authType === "custom_header") {
        const hn = String(cfg.customAuthHeader ?? "");
        const hv = String(cfg.customAuthValue ?? "");
        if (hn && hv) headers.set(hn, hv);
      }

      let bodyStr: string | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const bodyPayload = parsed.data.body !== undefined ? parsed.data.body : cfg.bodyTemplate;
        if (bodyPayload !== undefined && bodyPayload !== null) {
          const raw =
            typeof bodyPayload === "string"
              ? expandTemplateString(bodyPayload, flat)
              : expandTemplateString(JSON.stringify(bodyPayload), flat);
          try {
            const parsedJson = JSON.parse(raw);
            bodyStr = JSON.stringify(parsedJson);
          } catch {
            bodyStr = raw;
          }
          if (!headers.has("Content-Type") && typeof bodyStr === "string" && bodyStr.trim().startsWith("{")) {
            headers.set("Content-Type", "application/json");
          }
        }
      }

      const started = Date.now();
      let ok = false;
      let statusCode: number | null = null;
      let responseText = "";
      let errMsg: string | null = null;

      const reqSummary = {
        method,
        url: url.toString(),
        headerKeys: [...headers.keys()],
      };

      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25_000);
        const res = await fetch(url.toString(), { method, headers, body: bodyStr, signal: ctrl.signal });
        clearTimeout(t);
        statusCode = res.status;
        ok = res.ok;
        responseText = truncateBody(await res.text(), 50_000);
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      }

      const durationMs = Date.now() - started;

      const execRow = await prisma.$transaction(async (tx) => {
        const row = await tx.automationToolExecution.create({
          data: {
            organizationId,
            toolId: tool.id,
            source: "manual_test",
            ok: ok && statusCode !== null,
            statusCode,
            durationMs,
            requestSummary: asJson(reqSummary),
            responseSummary: asJson({
              preview: responseText.slice(0, 8000),
              truncated: responseText.length > 8000,
            }),
            errorMessage: errMsg,
            tokensUsed: null,
            botId: null,
          },
        });
        const current = await tx.automationCustomTool.findUnique({ where: { id: tool.id } });
        if (current) {
          const n = current.executionCount + 1;
          const nextAvg =
            current.avgDurationMs != null
              ? (current.avgDurationMs * current.executionCount + durationMs) / n
              : durationMs;
          await tx.automationCustomTool.update({
            where: { id: tool.id },
            data: {
              executionCount: n,
              avgDurationMs: nextAvg,
              lastExecutedAt: new Date(),
            },
          });
        }
        return row;
      });

      return {
        executionId: execRow.id,
        ok: ok && !errMsg,
        statusCode,
        durationMs,
        error: errMsg,
        responsePreview: responseText.slice(0, 12_000),
      };
    },
  );

  app.get("/agent-profiles", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const rows = await prisma.automationAgentProfile.findMany({
      where: { organizationId },
      include: {
        bot: {
          select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            webhookUrl: true,
            config: true,
          },
        },
      },
    });
    return {
      data: rows.map((r) => {
        const src = deriveBotAutomationSource({ webhookUrl: r.bot.webhookUrl, config: r.bot.config });
        const { bot: b, ...rest } = r;
        return {
          ...rest,
          bot: {
            id: b.id,
            name: b.name,
            description: b.description,
            isActive: b.isActive,
            webhookUrl: b.webhookUrl,
            editInExternalAutomation: src.editInExternalAutomation,
            managedByOpenConduit: src.managedByOpenConduit,
          },
          llmConfig: redactLlmConfig(r.llmConfig),
        };
      }),
    };
  });

  const agentProfileBodySchema = z.object({
    llmConfig: z.record(z.unknown()).optional(),
    behaviorConfig: z.record(z.unknown()).optional(),
    promptModuleIds: z.array(z.string().uuid()).optional().nullable(),
    botPatch: z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(4000).optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .optional(),
  });

  async function upsertAgentProfileForBot(params: {
    organizationId: string;
    botId: string;
    parsed: z.infer<typeof agentProfileBodySchema>;
  }) {
    const { organizationId, botId, parsed } = params;
    const existing = await prisma.automationAgentProfile.findUnique({
      where: { botId },
    });

    let llmConfig: Record<string, unknown> = existing
      ? (existing.llmConfig as Record<string, unknown>)
      : defaultLlmConfig();
    if (parsed.llmConfig) {
      const incoming = parsed.llmConfig as Record<string, unknown>;
      if (incoming.apiKey === "***") {
        delete incoming.apiKey;
      }
      llmConfig = { ...llmConfig, ...incoming };
    }

    const behaviorConfig = parsed.behaviorConfig
      ? { ...defaultBehaviorConfig(), ...(parsed.behaviorConfig as object) }
      : existing
        ? (existing.behaviorConfig as object)
        : defaultBehaviorConfig();

    const row = await prisma.automationAgentProfile.upsert({
      where: { botId },
      create: {
        organizationId,
        botId,
        llmConfig: asJson(llmConfig),
        behaviorConfig: asJson(behaviorConfig),
        promptModuleIds:
          parsed.promptModuleIds == null ? undefined : asJson(parsed.promptModuleIds),
      },
      update: {
        llmConfig: asJson(llmConfig),
        ...(parsed.behaviorConfig ? { behaviorConfig: asJson(behaviorConfig) } : {}),
        ...(parsed.promptModuleIds !== undefined
          ? {
              promptModuleIds:
                parsed.promptModuleIds == null ? Prisma.JsonNull : asJson(parsed.promptModuleIds),
            }
          : {}),
      },
    });

    return { row, llmConfig };
  }

  const createAutomationAgentSchema = z
    .object({
      createBot: z.boolean(),
      botId: z.string().uuid().optional(),
      botName: z.string().min(1).max(120).optional(),
      botDescription: z.string().max(4000).optional().nullable(),
      botIsActive: z.boolean().optional(),
      llmConfig: z.record(z.unknown()),
      behaviorConfig: z.record(z.unknown()),
      promptModuleIds: z.array(z.string().uuid()).optional().nullable(),
    })
    .superRefine((data, ctx) => {
      if (data.createBot) {
        if (!data.botName?.trim()) {
          ctx.addIssue({ code: "custom", message: "botName is required when createBot is true" });
        }
      } else if (!data.botId) {
        ctx.addIssue({ code: "custom", message: "botId is required when createBot is false" });
      }
    });

  app.post("/agents", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = createAutomationAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    let botId: string;
    if (parsed.data.createBot) {
      const created = await prisma.bot.create({
        data: {
          organizationId,
          name: parsed.data.botName!.trim(),
          description: parsed.data.botDescription ?? null,
          type: "WEBHOOK",
          webhookUrl: null,
          isActive: parsed.data.botIsActive ?? true,
          config: { automationManagedByOpenConduit: true } as Prisma.InputJsonValue,
        },
      });
      botId = created.id;
    } else {
      const bot = await prisma.bot.findFirst({
        where: { id: parsed.data.botId!, organizationId },
      });
      if (!bot) {
        return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
      }
      botId = bot.id;
    }

    const { row } = await upsertAgentProfileForBot({
      organizationId,
      botId,
      parsed: {
        llmConfig: parsed.data.llmConfig,
        behaviorConfig: parsed.data.behaviorConfig,
        promptModuleIds: parsed.data.promptModuleIds,
      },
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.agent.create",
      resourceType: "automation_agent_profile",
      resourceId: row.id,
      metadata: { botId, createdBot: parsed.data.createBot },
      ip: clientIp(request),
    });

    return reply.status(201).send({ ...row, llmConfig: redactLlmConfig(row.llmConfig) });
  });

  app.put<{ Params: { botId: string } }>("/agent-profiles/:botId", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const bot = await prisma.bot.findFirst({
      where: { id: request.params.botId, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }

    const parsed = agentProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    if (parsed.data.botPatch && Object.keys(parsed.data.botPatch).length > 0) {
      const bp = parsed.data.botPatch;
      await prisma.bot.update({
        where: { id: bot.id },
        data: {
          ...(bp.name !== undefined ? { name: bp.name } : {}),
          ...(bp.description !== undefined ? { description: bp.description } : {}),
          ...(bp.isActive !== undefined ? { isActive: bp.isActive } : {}),
        },
      });
    }

    const { row } = await upsertAgentProfileForBot({
      organizationId,
      botId: bot.id,
      parsed: parsed.data,
    });

    return { ...row, llmConfig: redactLlmConfig(row.llmConfig) };
  });

  app.delete<{ Params: { botId: string } }>(
    "/agent-profiles/:botId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const res = await prisma.automationAgentProfile.deleteMany({
        where: { botId: request.params.botId, organizationId },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Agent profile not found", statusCode: 404 });
      }
      return reply.status(204).send();
    },
  );

  app.get("/interactions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const data = await prisma.automationInteraction.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { bot: { select: { name: true } } },
    });
    return { data };
  });

  app.post("/interactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = interactionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const bot = await prisma.bot.findFirst({
      where: { id: parsed.data.botId, organizationId },
    });
    if (!bot) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid botId", statusCode: 400 });
    }
    if (parsed.data.conversationId) {
      const c = await prisma.conversation.findFirst({
        where: { id: parsed.data.conversationId, organizationId },
      });
      if (!c) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid conversationId", statusCode: 400 });
      }
    }
    const row = await prisma.automationInteraction.create({
      data: {
        organizationId,
        botId: parsed.data.botId,
        conversationId: parsed.data.conversationId ?? null,
        userMessage: parsed.data.userMessage,
        assistantMessage: parsed.data.assistantMessage,
        metadata: parsed.data.metadata == null ? undefined : asJson(parsed.data.metadata),
        knowledgeArticleIds:
          parsed.data.knowledgeArticleIds == null ? undefined : asJson(parsed.data.knowledgeArticleIds),
        escalatedToHuman: parsed.data.escalatedToHuman ?? false,
        responseType: parsed.data.responseType ?? null,
      },
    });
    return row;
  });

  app.get("/conversation-context", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const rows = await prisma.automationConversationContext.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { bot: { select: { id: true, name: true } } },
    });
    return {
      data: rows.map((r) => ({
        conversationId: r.conversationId,
        botId: r.botId,
        botName: r.bot.name,
        updatedAt: r.updatedAt,
        lastClearedAt: r.lastClearedAt,
      })),
    };
  });

  app.get<{ Params: { conversationId: string } }>(
    "/conversation-context/:conversationId",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!isTenantAdminLike(request.user)) {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
      }
      const row = await prisma.automationConversationContext.findFirst({
        where: { conversationId: request.params.conversationId, organizationId },
      });
      if (!row) {
        return reply.status(404).send({ error: "Not Found", message: "Context not found", statusCode: 404 });
      }
      return row;
    },
  );

  const contextPutSchema = z.object({
    botId: z.string().uuid(),
    state: z.record(z.unknown()),
    clearPolicy: z.record(z.unknown()).optional().nullable(),
  });

  app.put<{ Params: { conversationId: string } }>(
    "/conversation-context/:conversationId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const parsed = contextPutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const bot = await prisma.bot.findFirst({
        where: { id: parsed.data.botId, organizationId },
      });
      if (!bot) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botId", statusCode: 400 });
      }
      const conv = await prisma.conversation.findFirst({
        where: { id: request.params.conversationId, organizationId },
      });
      if (!conv) {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }
      const row = await prisma.automationConversationContext.upsert({
        where: { conversationId: conv.id },
        create: {
          organizationId,
          conversationId: conv.id,
          botId: parsed.data.botId,
          state: asJson(parsed.data.state),
          clearPolicy:
            parsed.data.clearPolicy == null ? undefined : asJson(parsed.data.clearPolicy),
        },
        update: {
          botId: parsed.data.botId,
          state: asJson(parsed.data.state),
          clearPolicy:
            parsed.data.clearPolicy === undefined
              ? undefined
              : parsed.data.clearPolicy == null
                ? Prisma.JsonNull
                : asJson(parsed.data.clearPolicy),
        },
      });
      return row;
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversation-context/:conversationId/clear",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const row = await prisma.automationConversationContext.updateMany({
        where: { conversationId: request.params.conversationId, organizationId },
        data: { state: asJson({}), lastClearedAt: new Date() },
      });
      if (row.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Context not found", statusCode: 404 });
      }
      return { ok: true };
    },
  );
}
