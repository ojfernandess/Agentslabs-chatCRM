import { createHash } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config, getPublicOrigin } from "../config.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { recordAuditLog, clientIp } from "../lib/audit.js";
import { AUTOMATION_TOOL_PRESETS, getPresetByKey } from "../lib/automationToolPresets.js";
import { assertHttpUrlAllowed, truncateBody } from "../lib/httpToolTest.js";
import {
  buildHttpToolFlatContext,
  expandTemplateString,
  resolveHttpRequestBody,
} from "../lib/automationHttpToolExecute.js";
import { redactAutomationToolConfig } from "../lib/automationWebhookBundle.js";
import {
  callGeminiGenerateContent,
  callOpenAiCompatibleChat,
  type PreviewChatTurn,
} from "../lib/promptModulePreviewLlm.js";
import {
  fetchProactiveKnowledgeSystemAppendix,
  mergeBotLinkedKnowledgeWhenRankedEmpty,
  parseLinkedKnowledgeArticleIdsFromBehavior,
  rankedKnowledgeSearch,
  syncKnowledgeArticleBotsFromPromptBuilder,
} from "../lib/knowledgeRetrieval.js";
import { parseNativeToolsFromBehavior, generateNativeAgentReply } from "../lib/agentNativeLlm.js";
import { ensureAgentProfileTestSandbox } from "../lib/agentTestChatSandbox.js";
import {
  buildSyncedPromptAutoInstructionBlock,
  mergeSystemWithAutoBlock,
  parseInstructionFallbacks,
  splitStoredSystemInstructions,
} from "../lib/agentPromptSync.js";
import { rankArticles } from "../lib/knowledgeSearchRanking.js";
import { reindexAllKnowledgeArticlesForOrg, reindexKnowledgeArticle } from "../lib/knowledgeReindex.js";
import {
  extractKnowledgeFileText,
  titleFromFilename,
  wrapIngestError,
} from "../lib/knowledgeFileIngest.js";
import { newWebhookToken, redactSourceForClient, syncKnowledgeSource } from "../lib/knowledgeSourceService.js";
import { registerAutomationExecutionLogRoutes } from "./automationExecutionLogRoutes.js";
import { registerChatbotFlowRoutes } from "./chatbotFlowRoutes.js";
import { clearAutomationConversationContext } from "../lib/automationConversationContextLib.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

async function aiPilotAccessEnabled(organizationId: string): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { organizationId },
    select: { aiPilotAccessEnabled: true },
  });
  return row?.aiPilotAccessEnabled ?? false;
}

async function canPilotAutomation(user: { role: string; actingOrganizationId?: string | null }, organizationId: string): Promise<boolean> {
  if (isTenantAdminLike(user)) return true;
  if (user.role !== "AGENT") return false;
  return aiPilotAccessEnabled(organizationId);
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
    transfer_to_team: false,
    set_conversation_status: false,
    list_google_calendars: false,
    scheduling_google: false,
    scheduling_outlook: false,
    ping: false,
    assign_contact_tags: false,
  },
  connectedTags: [] as Array<Record<string, unknown>>,
  escalationRules: {
    conditions: "",
    transferMessage: "",
    mode: "keyword" as string,
    keywords: "" as string,
    transferTeamId: null as string | null,
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

const knowledgeSourceKindSchema = z.enum([
  "web_url",
  "webhook_push",
  "gdrive",
  "notion",
  "web",
  "confluence",
  "zendesk",
  "github",
]);

const knowledgeSourceCreateSchema = z.object({
  kind: knowledgeSourceKindSchema,
  name: z.string().min(1).max(200),
  config: z.record(z.unknown()).optional().default({}),
  isActive: z.boolean().optional(),
});

const knowledgeSourcePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

async function validateKnowledgeSourceConfigForOrg(
  organizationId: string,
  kind: string,
  config: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids = Array.isArray(config.defaultBotIds) ? config.defaultBotIds : [];
  const botIds = ids.filter((x): x is string => typeof x === "string");
  if (botIds.length > 0) {
    const n = await prisma.bot.count({ where: { organizationId, id: { in: botIds } } });
    if (n !== botIds.length) return { ok: false, message: "Invalid defaultBotIds" };
  }
  if (kind === "web_url") {
    const url = typeof config.url === "string" ? config.url.trim() : "";
    if (!url) return { ok: false, message: "web_url sources require config.url" };
    try {
      assertHttpUrlAllowed(url);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Invalid URL" };
    }
  }
  if (kind === "web") {
    const u = typeof config.siteRootUrl === "string" ? config.siteRootUrl.trim() : "";
    if (u) {
      try {
        assertHttpUrlAllowed(u);
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Invalid siteRootUrl" };
      }
    }
  }
  if (kind === "confluence") {
    const u = typeof config.confluenceBaseUrl === "string" ? config.confluenceBaseUrl.trim() : "";
    if (u) {
      try {
        assertHttpUrlAllowed(u);
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Invalid confluenceBaseUrl" };
      }
    }
  }
  return { ok: true };
}

function multipartBool(raw: string | undefined, defaultVal: boolean): boolean {
  if (raw === undefined || raw === "") return defaultVal;
  const s = raw.toLowerCase().trim();
  if (s === "false" || s === "0" || s === "no") return false;
  if (s === "true" || s === "1" || s === "yes") return true;
  return defaultVal;
}

function parseMultipartUuidArray(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("botIds must be a JSON array of UUID strings");
  }
  if (!Array.isArray(v)) throw new Error("botIds must be a JSON array");
  const ids: string[] = [];
  for (const x of v) {
    const id = String(x).trim();
    if (!z.string().uuid().safeParse(id).success) {
      throw new Error(`Invalid botId: ${id}`);
    }
    ids.push(id);
  }
  return ids;
}

function parseMultipartTags(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map((s) => s.slice(0, 64))
      .slice(0, 64);
  } catch {
    return [];
  }
}

const promptModuleSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/),
  body: z.string().min(1),
  version: z.number().int().min(1).optional(),
  labels: z.record(z.unknown()).optional().nullable(),
});

const promptPreviewSchema = z.object({
  systemPrompt: z.string().min(1).max(120_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(48_000),
      }),
    )
    .max(40)
    .optional()
    .default([]),
  userMessage: z.string().min(1).max(48_000),
  provider: z.enum(["openai", "google_gemini"]),
  model: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().int().min(16).max(8192).optional().default(1024),
  apiBaseUrl: z.string().max(2000).optional().nullable(),
  apiKey: z.string().max(4000).optional().nullable(),
  promptModuleId: z.string().uuid().optional().nullable(),
  recordMetrics: z.boolean().optional().default(false),
});

async function mergePromptModulePreviewAnalytics(
  organizationId: string,
  promptModuleId: string,
  tokensDelta: number,
  latencyMs: number,
): Promise<void> {
  const row = await prisma.automationPromptModule.findFirst({
    where: { id: promptModuleId, organizationId },
    select: { labels: true },
  });
  if (!row) return;
  const labels =
    row.labels && typeof row.labels === "object" && !Array.isArray(row.labels)
      ? { ...(row.labels as Record<string, unknown>) }
      : {};
  const analyticsRaw = labels.analytics;
  const a =
    analyticsRaw && typeof analyticsRaw === "object"
      ? { ...(analyticsRaw as Record<string, unknown>) }
      : {};
  const executions = Number(a.executions ?? 0) + 1;
  const tokens = Number(a.tokens ?? 0) + tokensDelta;
  const prevAvg = Number(a.avgMs ?? 0);
  const avgMs =
    executions <= 1 ? latencyMs : Math.round((prevAvg * (executions - 1) + latencyMs) / executions);
  const prevSr = Number(a.successRate ?? 1);
  const successRate = (prevSr * (executions - 1) + 1) / executions;

  labels.analytics = {
    ...a,
    executions,
    tokens,
    avgMs,
    successRate,
    lastPreviewAt: new Date().toISOString(),
  };

  await prisma.automationPromptModule.updateMany({
    where: { id: promptModuleId, organizationId },
    data: { labels: asJson(labels) },
  });
}

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

const TOOL_CONFIG_SECRET_KEYS = new Set([
  "apiKey",
  "api_key",
  "accessToken",
  "refreshToken",
  "password",
  "smtpPassword",
  "token",
  "authToken",
  "botToken",
  "secretKey",
  "bearerToken",
  "basicPassword",
  "customAuthValue",
  "signingSecret",
]);

function mergeToolConfig(existing: unknown, incoming: unknown): Record<string, unknown> {
  const e = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  const i = incoming && typeof incoming === "object" ? { ...(incoming as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(i)) {
    if (v === "***") delete i[k];
    if (typeof v === "string" && !v.trim() && TOOL_CONFIG_SECRET_KEYS.has(k)) delete i[k];
  }
  return { ...e, ...i };
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
    if (!(await canPilotAutomation(request.user, organizationId))) {
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

    void reindexKnowledgeArticle(row.id).catch((err) => {
      request.log.warn({ err, articleId: row.id }, "knowledge reindex failed");
    });

    return { ...row, botIds: row.botLinks.map((l) => l.botId) };
  });

  app.post("/knowledge-articles/import-file", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    let fileBuf: Buffer | null = null;
    let fileName = "upload";
    let fileMime = "";
    const fields: Record<string, string> = {};

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileBuf = await part.toBuffer();
          fileName = part.filename || "upload";
          fileMime = part.mimetype || "";
        } else {
          fields[part.fieldname] = String(part.value ?? "");
        }
      }
    } catch (err) {
      request.log.warn({ err }, "knowledge import multipart parse failed");
      return reply.status(400).send({
        error: "Bad Request",
        code: "kb_import_multipart",
        message: "Invalid multipart body",
        statusCode: 400,
      });
    }

    if (!fileBuf?.length) {
      return reply.status(400).send({
        error: "Bad Request",
        code: "kb_import_no_file",
        message: "Expected one file field in multipart form",
        statusCode: 400,
      });
    }

    let extractedText: string;
    let detectedMime: string;
    try {
      const ingested = await extractKnowledgeFileText({
        buffer: fileBuf,
        filename: fileName,
        mimetype: fileMime,
      });
      extractedText = ingested.text;
      detectedMime = ingested.mimeType;
    } catch (e) {
      const ke = wrapIngestError(e);
      const status = ke.code === "unsupported_type" ? 415 : 400;
      return reply.status(status).send({
        error: status === 415 ? "Unsupported Media Type" : "Bad Request",
        code: `kb_import_${ke.code}`,
        message: ke.message,
        statusCode: status,
      });
    }

    let botIds: string[] = [];
    try {
      botIds = parseMultipartUuidArray(fields.botIds);
    } catch (e) {
      return reply.status(400).send({
        error: "Bad Request",
        message: e instanceof Error ? e.message : "Invalid botIds",
        statusCode: 400,
      });
    }

    if (botIds.length > 0) {
      const n = await prisma.bot.count({ where: { organizationId, id: { in: botIds } } });
      if (n !== botIds.length) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid botIds", statusCode: 400 });
      }
    }

    const titleRaw = fields.title?.trim();
    const title = (titleRaw && titleRaw.length > 0 ? titleRaw : titleFromFilename(fileName)).slice(0, 500);
    const category = fields.category?.trim() ? fields.category.trim().slice(0, 120) : null;
    const tags = parseMultipartTags(fields.tags);
    const isActive = multipartBool(fields.isActive, true);
    const syncToAi = multipartBool(fields.syncToAi, true);

    const row = await prisma.automationKnowledgeArticle.create({
      data: {
        organizationId,
        title,
        content: extractedText,
        category,
        tags,
        isActive,
        syncToAi,
        sourceFileName: fileName.slice(0, 500),
        sourceMimeType: (fileMime || detectedMime).slice(0, 160),
        botLinks: botIds.length ? { create: botIds.map((botId) => ({ botId })) } : undefined,
      },
      include: { botLinks: { select: { botId: true } } },
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge.import",
      resourceType: "automation_knowledge_article",
      resourceId: row.id,
      ip: clientIp(request),
    });

    void reindexKnowledgeArticle(row.id).catch((err) => {
      request.log.warn({ err, articleId: row.id }, "knowledge reindex failed");
    });

    const { botLinks, ...rest } = row;
    return {
      ...rest,
      botIds: botLinks.map((l) => l.botId),
      extractedChars: extractedText.length,
    };
  });

  app.get("/knowledge-sources", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canPilotAutomation(request.user, organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const rows = await prisma.automationKnowledgeSource.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    const withArticle = await Promise.all(
      rows.map(async (r) => {
        const n = await prisma.automationKnowledgeArticle.count({
          where: { organizationId, knowledgeSourceId: r.id },
        });
        return { ...redactSourceForClient(r), linkedArticles: n };
      }),
    );
    return { data: withArticle };
  });

  app.post("/knowledge-sources", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = knowledgeSourceCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const body = parsed.data;
    const cfg = body.config as Record<string, unknown>;
    const validated = await validateKnowledgeSourceConfigForOrg(organizationId, body.kind, cfg);
    if (!validated.ok) {
      return reply.status(400).send({ error: "Bad Request", message: validated.message, statusCode: 400 });
    }

    const webhookToken = body.kind === "webhook_push" ? newWebhookToken() : null;

    const row = await prisma.automationKnowledgeSource.create({
      data: {
        organizationId,
        kind: body.kind,
        name: body.name,
        config: body.config as object,
        isActive: body.isActive ?? true,
        webhookToken,
      },
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge_source.create",
      resourceType: "automation_knowledge_source",
      resourceId: row.id,
      ip: clientIp(request),
    });

    const base = getPublicOrigin();
    const out: Record<string, unknown> = {
      ...redactSourceForClient(row),
      linkedArticles: 0,
    };
    if (body.kind === "webhook_push" && webhookToken) {
      out.webhookUrlOnce = `${base}/api/v1/public/knowledge-source-push/${webhookToken}`;
      out.webhookTokenOnce = webhookToken;
    }
    return out;
  });

  app.patch<{ Params: { id: string } }>("/knowledge-sources/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = knowledgeSourcePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.automationKnowledgeSource.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Source not found", statusCode: 404 });
    }
    const data: { name?: string; config?: object; isActive?: boolean } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.config !== undefined) {
      const prev =
        existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
          ? { ...(existing.config as Record<string, unknown>) }
          : {};
      const merged = { ...prev, ...(parsed.data.config as Record<string, unknown>) };
      const validated = await validateKnowledgeSourceConfigForOrg(organizationId, existing.kind, merged);
      if (!validated.ok) {
        return reply.status(400).send({ error: "Bad Request", message: validated.message, statusCode: 400 });
      }
      data.config = merged;
    }
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    const row = await prisma.automationKnowledgeSource.update({
      where: { id: existing.id },
      data,
    });
    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge_source.update",
      resourceType: "automation_knowledge_source",
      resourceId: row.id,
      ip: clientIp(request),
    });
    const n = await prisma.automationKnowledgeArticle.count({
      where: { organizationId, knowledgeSourceId: row.id },
    });
    return { ...redactSourceForClient(row), linkedArticles: n };
  });

  app.delete<{ Params: { id: string } }>("/knowledge-sources/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.automationKnowledgeSource.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Source not found", statusCode: 404 });
    }
    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "automation.knowledge_source.delete",
      resourceType: "automation_knowledge_source",
      resourceId: request.params.id,
      ip: clientIp(request),
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/knowledge-sources/:id/sync", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const result = await syncKnowledgeSource({ sourceId: request.params.id, organizationId });
    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "url_blocked" || result.code === "bad_config" || result.code === "inactive"
            ? 400
            : 502;
      return reply.status(status).send({
        error: status === 404 ? "Not Found" : status === 400 ? "Bad Request" : "Bad Gateway",
        code: result.code,
        message: result.message,
        statusCode: status,
      });
    }
    return { ok: true, articleId: result.articleId, message: result.message };
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

    if (
      parsed.data.content !== undefined ||
      parsed.data.title !== undefined ||
      parsed.data.syncToAi !== undefined ||
      parsed.data.isActive !== undefined
    ) {
      void reindexKnowledgeArticle(row.id).catch((err) => {
        request.log.warn({ err, articleId: row.id }, "knowledge reindex failed");
      });
    }

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

  app.post<{ Params: { id: string } }>("/knowledge-articles/:id/reindex", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const article = await prisma.automationKnowledgeArticle.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!article) {
      return reply.status(404).send({ error: "Not Found", message: "Article not found", statusCode: 404 });
    }
    try {
      const result = await reindexKnowledgeArticle(article.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "reindex failed";
      return reply.status(502).send({
        error: "Bad Gateway",
        code: "kb_reindex_failed",
        message: msg.slice(0, 1500),
        statusCode: 502,
      });
    }
  });

  app.post("/knowledge-articles/reindex-organization", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    try {
      const summary = await reindexAllKnowledgeArticlesForOrg(organizationId);
      return summary;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "reindex failed";
      return reply.status(502).send({
        error: "Bad Gateway",
        code: "kb_reindex_org_failed",
        message: msg.slice(0, 1500),
        statusCode: 502,
      });
    }
  });

  app.get("/knowledge-articles/hub-metrics", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canPilotAutomation(request.user, organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }

    const articles = await prisma.automationKnowledgeArticle.findMany({
      where: { organizationId },
      select: {
        id: true,
        title: true,
        category: true,
        tags: true,
        isActive: true,
        syncToAi: true,
        content: true,
        updatedAt: true,
        sourceFileName: true,
      },
    });

    const totalDocuments = articles.length;
    const activeDocuments = articles.filter((a) => a.isActive).length;
    const syncEnabled = articles.filter((a) => a.syncToAi).length;
    let totalChars = 0;
    for (const a of articles) totalChars += a.content.length;
    const estimatedTokens = Math.round(totalChars / 4);
    const chunkSize = 1500;
    let estimatedChunks = 0;
    for (const a of articles) estimatedChunks += Math.max(1, Math.ceil(a.content.length / chunkSize));

    const lastUpdatedAt =
      articles.length === 0
        ? null
        : new Date(Math.max(...articles.map((a) => a.updatedAt.getTime()))).toISOString();

    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const logs = await prisma.kbSearchLog.findMany({
      where: { organizationId, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
      take: 2500,
    });

    const queryAgg = new Map<string, { count: number; resultsSum: number; zeroHits: number }>();
    for (const log of logs) {
      const q = log.queryNormalized;
      const cur = queryAgg.get(q) ?? { count: 0, resultsSum: 0, zeroHits: 0 };
      cur.count += 1;
      cur.resultsSum += log.resultsCount;
      if (log.resultsCount === 0) cur.zeroHits += 1;
      queryAgg.set(q, cur);
    }

    const topQueries = [...queryAgg.entries()]
      .map(([query, v]) => ({
        query,
        count: v.count,
        avgResults: v.count ? v.resultsSum / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const searchesWeek = logs.length;
    const successfulSearches = logs.filter((l) => l.resultsCount > 0).length;
    const searchSuccessRate = searchesWeek === 0 ? null : successfulSearches / searchesWeek;

    const categories = [...new Set(articles.map((a) => a.category).filter((c): c is string => Boolean(c?.trim())))].sort();

    const indexedChunks = await prisma.automationKnowledgeChunk.count({ where: { organizationId } });
    const connectedSources = await prisma.automationKnowledgeSource.count({ where: { organizationId } });
    const sampleChunk = await prisma.automationKnowledgeChunk.findFirst({
      where: { organizationId },
      select: { embeddingModel: true },
    });

    return {
      totalDocuments,
      activeDocuments,
      syncEnabled,
      estimatedTokens,
      estimatedChunks,
      connectedSources,
      indexedChunks,
      embeddingModel: sampleChunk?.embeddingModel ?? null,
      semanticSearchReady: indexedChunks > 0 && Boolean(config.openAiPromptPreviewKey),
      lastUpdatedAt,
      searchesWeek,
      searchSuccessRate,
      topQueries,
      categories,
      documentsPreview: articles
        .slice()
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 8)
        .map((a) => ({
          id: a.id,
          title: a.title,
          category: a.category,
          tags: a.tags,
          isActive: a.isActive,
          syncToAi: a.syncToAi,
          updatedAt: a.updatedAt.toISOString(),
          sourceFileName: a.sourceFileName,
          estimatedChunks: Math.max(1, Math.ceil(a.content.length / chunkSize)),
          estimatedTokens: Math.round(a.content.length / 4),
        })),
    };
  });

  const kbPlaygroundSchema = z.object({
    query: z.string().min(1).max(500),
    botId: z.string().uuid().optional().nullable(),
    provider: z.enum(["openai", "google_gemini"]),
    model: z.string().min(1).max(120),
    temperature: z.number().min(0).max(2).optional().default(0.35),
    maxTokens: z.number().int().min(64).max(4096).optional().default(900),
    maxContextChars: z.number().int().min(800).max(48_000).optional().default(14_000),
    apiBaseUrl: z.string().max(2000).optional().nullable(),
    apiKey: z.string().max(4000).optional().nullable(),
    topK: z.number().int().min(1).max(12).optional().default(6),
  });

  app.post("/knowledge-articles/playground", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = kbPlaygroundSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const body = parsed.data;
    const norm = body.query.trim().toLowerCase().slice(0, 500);
    const botId = body.botId ?? undefined;

    let apiKey = body.apiKey?.trim() ?? "";
    if (body.provider === "openai") {
      if (!apiKey) apiKey = config.openAiPromptPreviewKey;
    } else if (!apiKey) {
      apiKey = config.geminiPromptPreviewKey;
    }
    if (!apiKey) {
      return reply.status(400).send({
        error: "Bad Request",
        code: "kb_playground_no_api_key",
        message: "Missing API key for LLM (or configure server OPENAI_* / GEMINI_PROMPT_PREVIEW_KEY).",
        statusCode: 400,
      });
    }

    const { ranked, mode: retrievalMode } = await rankedKnowledgeSearch({
      organizationId,
      normalizedQuery: norm,
      botId,
      limit: body.topK,
      debugLog: request.log,
    });

    const sources = ranked.map((r) => ({
      id: r.article.id,
      title: r.article.title,
      score: Math.round(r.score * 1000) / 1000,
      excerpt: r.excerpt,
    }));

    let contextChars = 0;
    const blocks: string[] = [];
    const maxCtx = body.maxContextChars;
    for (const r of ranked) {
      const header = `[${r.article.title}]\n`;
      const chunk = `${header}${r.article.content.slice(0, 6000)}`;
      if (contextChars + chunk.length > maxCtx) break;
      blocks.push(chunk);
      contextChars += chunk.length;
    }

    const systemPrompt = `És um assistente que responde APENAS com base nos trechos da base de conhecimento abaixo. Se não houver informação suficiente, diz-o claramente em uma frase. Cita o título do documento quando usares um trecho. Responde no mesmo idioma da pergunta do utilizador.\n\n---\n${blocks.join("\n\n---\n")}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    const started = Date.now();
    try {
      let answer: string;
      if (body.provider === "openai") {
        const baseUrl = (body.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
        try {
          assertHttpUrlAllowed(baseUrl);
        } catch (e) {
          clearTimeout(timer);
          return reply.status(400).send({
            error: "Bad Request",
            message: e instanceof Error ? e.message : "Invalid API base URL",
            statusCode: 400,
          });
        }
        const res = await callOpenAiCompatibleChat({
          baseUrl,
          apiKey,
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          system: systemPrompt,
          history: [],
          userMessage: body.query.trim(),
          signal: ctrl.signal,
        });
        answer = res.text;
      } else {
        const res = await callGeminiGenerateContent({
          apiKey,
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          system: systemPrompt,
          history: [],
          userMessage: body.query.trim(),
          signal: ctrl.signal,
        });
        answer = res.text;
      }
      clearTimeout(timer);
      return {
        answer,
        sources,
        retrievalMode,
        latencyMs: Date.now() - started,
        contextChars,
      };
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      const msg = err instanceof Error ? err.message : "LLM request failed";
      return reply.status(aborted ? 504 : 502).send({
        error: aborted ? "Gateway Timeout" : "Bad Gateway",
        code: aborted ? "kb_playground_timeout" : "kb_playground_llm_error",
        message: msg.slice(0, 1500),
        statusCode: aborted ? 504 : 502,
      });
    }
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
    const botKey = parsed.data.botId ?? "";
    const semanticActive =
      Boolean(config.openAiPromptPreviewKey) &&
      (await prisma.automationKnowledgeChunk.count({ where: { organizationId } })) > 0;
    const hash = createHash("sha256")
      .update(`${organizationId}:${norm}:${botKey}:${semanticActive ? "sem" : "lex"}`)
      .digest("hex");
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
      const byId = new Map(articles.map((a) => [a.id, a]));
      const ordered = ids.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
      const rankedRows = ordered.map((article) => rankArticles([article], norm)[0]);
      await prisma.kbSearchLog.create({
        data: {
          organizationId,
          queryNormalized: norm,
          resultsCount: rankedRows.length,
          actorUserId: request.user.id,
        },
      });
      return {
        cached: true,
        searchMode: "cached" as const,
        data: rankedRows.map((r) => r.article),
        ranking: rankedRows.map((r) => ({
          id: r.article.id,
          score: Math.round(r.score * 1000) / 1000,
          excerpt: r.excerpt,
        })),
      };
    }

    let { ranked, mode: searchMode } = await rankedKnowledgeSearch({
      organizationId,
      normalizedQuery: norm,
      botId: parsed.data.botId,
      limit: 25,
      debugLog: request.log,
    });
    if (parsed.data.botId) {
      ranked = await mergeBotLinkedKnowledgeWhenRankedEmpty({
        organizationId,
        botId: parsed.data.botId,
        ranked,
        debugLog: request.log,
      });
    }

    const articleIds = ranked.map((r) => r.article.id);
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
        resultsCount: ranked.length,
        actorUserId: request.user.id,
      },
    });

    return {
      cached: false,
      searchMode,
      data: ranked.map((r) => r.article),
      ranking: ranked.map((r) => ({
        id: r.article.id,
        score: Math.round(r.score * 1000) / 1000,
        excerpt: r.excerpt,
      })),
    };
  });

  app.get("/prompt-modules", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canPilotAutomation(request.user, organizationId))) {
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

  app.get("/prompt-modules/preview-options", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return {
      hasPlatformOpenAiKey: config.openAiPromptPreviewKey.length > 0,
      hasPlatformGeminiKey: config.geminiPromptPreviewKey.length > 0,
    };
  });

  app.post("/prompt-modules/preview", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = promptPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const body = parsed.data;
    let apiKey = body.apiKey?.trim() ?? "";
    if (body.provider === "openai") {
      if (!apiKey) apiKey = config.openAiPromptPreviewKey;
    } else if (!apiKey) {
      apiKey = config.geminiPromptPreviewKey;
    }
    if (!apiKey) {
      return reply.status(400).send({
        error: "Bad Request",
        code: "prompt_preview_no_api_key",
        message:
          "Missing API key: enter one in the preview panel or set OPENAI_PROMPT_PREVIEW_KEY / OPENAI_API_KEY (OpenAI) or GEMINI_PROMPT_PREVIEW_KEY (Gemini) on the server.",
        statusCode: 400,
      });
    }

    const history = body.history as PreviewChatTurn[];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    const started = Date.now();
    try {
      let text: string;
      let usage: { prompt: number; completion: number; total: number } | undefined;
      if (body.provider === "openai") {
        const baseUrl = (body.apiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
        try {
          assertHttpUrlAllowed(baseUrl);
        } catch (e) {
          clearTimeout(timer);
          return reply.status(400).send({
            error: "Bad Request",
            message: e instanceof Error ? e.message : "Invalid API base URL",
            statusCode: 400,
          });
        }
        const r = await callOpenAiCompatibleChat({
          baseUrl,
          apiKey,
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          system: body.systemPrompt,
          history,
          userMessage: body.userMessage,
          signal: ctrl.signal,
        });
        text = r.text;
        usage = r.usage;
      } else {
        const r = await callGeminiGenerateContent({
          apiKey,
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          system: body.systemPrompt,
          history,
          userMessage: body.userMessage,
          signal: ctrl.signal,
        });
        text = r.text;
        usage = r.usage;
      }
      clearTimeout(timer);
      const latencyMs = Date.now() - started;

      if (body.recordMetrics && body.promptModuleId) {
        await mergePromptModulePreviewAnalytics(
          organizationId,
          body.promptModuleId,
          usage?.total ?? 0,
          latencyMs,
        );
      }

      return {
        reply: text,
        usage: usage
          ? {
              promptTokens: usage.prompt,
              completionTokens: usage.completion,
              totalTokens: usage.total,
            }
          : null,
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      const msg = err instanceof Error ? err.message : "LLM request failed";
      return reply.status(aborted ? 504 : 502).send({
        error: aborted ? "Gateway Timeout" : "Bad Gateway",
        code: aborted ? "prompt_preview_timeout" : "prompt_preview_llm_error",
        message: msg.slice(0, 1500),
        statusCode: aborted ? 504 : 502,
      });
    }
  });

  app.get("/tool-presets", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canPilotAutomation(request.user, organizationId))) {
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
    if (!(await canPilotAutomation(request.user, organizationId))) {
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

  const toolTestBodySchema = z
    .object({
      pathParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      headers: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      sampleContext: z.record(z.unknown()).optional(),
    })
    .passthrough();

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
      const testArgs = parsed.data as Record<string, unknown>;
      const flat = buildHttpToolFlatContext(testArgs);

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
          url.searchParams.set(qk, String(qv));
        }
      }
      const defaultQuery = cfg.defaultQuery && typeof cfg.defaultQuery === "object" ? (cfg.defaultQuery as Record<string, unknown>) : {};
      for (const [qk, qv] of Object.entries(defaultQuery)) {
        if (typeof qv === "string") {
          const expanded = expandTemplateString(qv, flat);
          if (!url.searchParams.has(qk)) url.searchParams.set(qk, expanded);
        } else if (typeof qv === "number" || typeof qv === "boolean") {
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
      let bodySource: string | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const resolvedBody = resolveHttpRequestBody({ cfg, args: testArgs, flat });
        bodyStr = resolvedBody.bodyStr;
        bodySource = resolvedBody.source;
        if (bodyStr && resolvedBody.contentType && !headers.has("Content-Type")) {
          headers.set("Content-Type", resolvedBody.contentType);
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
        bodySource,
        bodyBytes: bodyStr?.length ?? 0,
        bodyPreview: bodyStr ? truncateBody(bodyStr, 4000) : null,
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

  const promptBuilderSuggestSchema = z.object({
    kind: z.enum(["connected_tool", "team_transfer", "escalation", "connected_tag"]),
    locale: z.enum(["pt-BR", "en"]).optional().default("pt-BR"),
    agentContextSnippet: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().slice(0, 8000) : ""),
      z.string().max(8000).optional().default(""),
    ),
    toolName: z.string().max(240).optional(),
    toolDescription: z.string().max(4000).optional(),
    teamName: z.string().max(240).optional(),
    teamId: z.string().max(80).optional(),
    tagName: z.string().max(240).optional(),
    tagId: z.string().max(80).optional(),
    escalationMode: z.string().max(64).optional(),
    escalationKeywords: z.string().max(2000).optional(),
    escalationTransferMessage: z.string().max(2000).optional(),
  });

  app.post(
    "/prompt-builder/suggest-instruction",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!isTenantAdminLike(request.user)) {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
      }
      const parsed = promptBuilderSuggestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Pedido inválido para gerar instrução.",
          statusCode: 400,
        });
      }
      const d = parsed.data;
      const apiKey = config.openAiPromptPreviewKey.trim();
      if (!apiKey) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "OPENAI_PROMPT_PREVIEW_KEY is not configured on the server.",
          statusCode: 503,
        });
      }
      const lang = d.locale === "en" ? "English" : "Portuguese (Brazil)";
      const ctx = (d.agentContextSnippet ?? "").trim().slice(0, 6000);
      let userContent = "";
      if (d.kind === "connected_tool") {
        userContent = [
          "Generate system-instruction lines for a customer-facing AI agent (concise, imperative).",
          `Output language: ${lang}.`,
          `Tool name: ${d.toolName ?? "unknown"}`,
          `Tool description / contract: ${(d.toolDescription ?? "").trim() || "(none)"}`,
          `Agent core context (may be partial):\n${ctx || "(none)"}`,
          "",
          "Reply with ONLY the instruction text (2–6 short sentences), no markdown fences, no JSON.",
        ].join("\n");
      } else if (d.kind === "team_transfer") {
        userContent = [
          "Generate when-to-transfer instructions for a support agent that may call transfer_to_team with a UUID.",
          `Output language: ${lang}.`,
          `Team name: ${d.teamName ?? "team"}`,
          `Team UUID: ${d.teamId ?? "(not set)"}`,
          `Agent core context:\n${ctx || "(none)"}`,
          "",
          "Reply with ONLY the instruction paragraph(s) (when to route to this team, tone, confirm to customer).",
        ].join("\n");
      } else if (d.kind === "connected_tag") {
        userContent = [
          "Generate when-to-apply instructions for a customer-facing AI agent that assigns CRM tags via the atribuir_etiquetas tool.",
          `Output language: ${lang}.`,
          `Tag name: ${d.tagName ?? "tag"}`,
          `Tag UUID: ${d.tagId ?? "(not set)"}`,
          `Agent core context:\n${ctx || "(none)"}`,
          "",
          "Reply with ONLY the instruction text (2–6 short sentences): clear criteria for when to call atribuir_etiquetas with this tag_id, examples of customer phrases, and what NOT to tag. No markdown fences, no JSON.",
        ].join("\n");
      } else {
        userContent = [
          "Generate escalation instructions for an AI agent: when rules trigger, how to hand off to humans.",
          `Output language: ${lang}.`,
          `Escalation mode: ${d.escalationMode ?? "(unspecified)"}`,
          `Keywords / triggers: ${(d.escalationKeywords ?? "").trim() || "(none)"}`,
          `Message template: ${(d.escalationTransferMessage ?? "").trim() || "(none)"}`,
          d.teamId && d.teamName
            ? `Destination team UUID ${d.teamId} (${d.teamName}) — use transfer_to_team with this team_id when escalating.`
            : "If a destination team UUID exists in settings, use transfer_to_team with that id when escalating.",
          `Agent context:\n${ctx || "(none)"}`,
          "",
          "Reply with ONLY the instruction paragraph(s).",
        ].join("\n");
      }

      const system =
        "You help configure AI agents for OpenConduit CRM. Be practical and specific. No preamble or closing.";

      try {
        const r = await callOpenAiCompatibleChat({
          baseUrl: "https://api.openai.com/v1",
          apiKey,
          model: "gpt-4o-mini",
          temperature: 0.35,
          maxTokens: 512,
          system,
          history: [] as PreviewChatTurn[],
          userMessage: userContent,
          signal: AbortSignal.timeout(25_000),
        });
        const instruction = (r.text ?? "").trim().slice(0, 4000);
        if (!instruction) {
          return reply.status(502).send({ error: "Bad Gateway", message: "Empty model response", statusCode: 502 });
        }
        return { instruction };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "suggestion_failed";
        return reply.status(502).send({ error: "Bad Gateway", message: msg.slice(0, 1200), statusCode: 502 });
      }
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

  const agentProfileTestChatSchema = z.object({
    message: z.string().min(1).max(48_000),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(48_000),
        }),
      )
      .max(30)
      .optional()
      .default([]),
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

    if (parsed.behaviorConfig) {
      await syncKnowledgeArticleBotsFromPromptBuilder({
        organizationId,
        botId,
        behaviorConfig,
      });
    }

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

  app.post<{ Params: { botId: string } }>(
    "/agent-profiles/:botId/sync-prompt",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const profile = await prisma.automationAgentProfile.findFirst({
        where: { organizationId, botId: request.params.botId },
        include: {
          bot: {
            select: { id: true, name: true, description: true, isActive: true, webhookUrl: true, config: true },
          },
        },
      });
      if (!profile) {
        return reply.status(404).send({ error: "Not Found", message: "Agent profile not found", statusCode: 404 });
      }

      const llm = (profile.llmConfig as Record<string, unknown>) ?? {};
      const behavior = (profile.behaviorConfig as Record<string, unknown>) ?? {};
      const pbRaw = behavior.promptBuilder;
      const pb = pbRaw && typeof pbRaw === "object" ? (pbRaw as Record<string, unknown>) : {};

      const userCore =
        typeof pb.userCore === "string"
          ? pb.userCore
          : splitStoredSystemInstructions(String(llm.systemInstructions ?? "")).userCore;

      const linkedIds = parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig);
      const linkedArticles = linkedIds.length
        ? await prisma.automationKnowledgeArticle.findMany({
            where: { organizationId, id: { in: linkedIds }, isActive: true, syncToAi: true },
            select: { id: true, title: true },
          })
        : [];
      const titleById = new Map(linkedArticles.map((a) => [a.id, a.title]));
      const linkedTitles = linkedIds.map((id) => titleById.get(id)).filter((x): x is string => Boolean(x));

      const connected = Array.isArray(behavior.connectedTools)
        ? (behavior.connectedTools as Array<Record<string, unknown>>)
        : [];
      const enabledConnected = connected.filter(
        (x) => x && x.enabled === true && typeof x.toolId === "string" && x.toolId.trim(),
      );
      const toolIds = enabledConnected.map((x) => String(x.toolId).trim());
      const toolRows = toolIds.length
        ? await prisma.automationCustomTool.findMany({
            where: { organizationId, id: { in: toolIds }, isActive: true },
            select: { id: true, name: true },
          })
        : [];
      const toolNameById = new Map(toolRows.map((t) => [t.id, t.name]));
      const connectedToolNames = toolIds.map((id) => toolNameById.get(id)).filter((x): x is string => Boolean(x));
      const connectedToolInstructions = enabledConnected
        .map((x) => {
          const toolId = String(x.toolId).trim();
          const name = toolNameById.get(toolId);
          const instruction = typeof x.agentInstruction === "string" ? x.agentInstruction.trim() : "";
          if (!name || !instruction) return null;
          return { name, instruction, toolId };
        })
        .filter((x): x is { name: string; instruction: string; toolId: string } => x != null);

      const connectedTagRows = Array.isArray(behavior.connectedTags)
        ? (behavior.connectedTags as Array<Record<string, unknown>>)
        : [];
      const enabledConnectedTags = connectedTagRows.filter(
        (x) => x && x.enabled === true && typeof x.tagId === "string" && x.tagId.trim(),
      );
      const tagIds = enabledConnectedTags.map((x) => String(x.tagId).trim());
      const tagRows = tagIds.length
        ? await prisma.tag.findMany({
            where: { organizationId, id: { in: tagIds } },
            select: { id: true, name: true },
          })
        : [];
      const tagNameById = new Map(tagRows.map((t) => [t.id, t.name]));
      const connectedTagInstructions = enabledConnectedTags
        .map((x) => {
          const tagId = String(x.tagId).trim();
          const name = tagNameById.get(tagId);
          const instruction = typeof x.agentInstruction === "string" ? x.agentInstruction.trim() : "";
          if (!name || !instruction) return null;
          return { name, instruction, tagId };
        })
        .filter((x): x is { name: string; instruction: string; tagId: string } => x != null);

      const hintsRaw = pb.teamTransferHints;
      const teamHintBase: Array<{ teamId: string; instruction: string }> = Array.isArray(hintsRaw)
        ? hintsRaw
            .map((x) => {
              if (!x || typeof x !== "object") return null;
              const o = x as Record<string, unknown>;
              const teamId = typeof o.teamId === "string" ? o.teamId.trim() : "";
              const instruction = typeof o.instruction === "string" ? o.instruction.trim() : "";
              if (!teamId || !instruction) return null;
              return { teamId, instruction };
            })
            .filter((x): x is { teamId: string; instruction: string } => x != null)
        : [];
      const teamIds = teamHintBase.map((h) => h.teamId);
      const teamRows = teamIds.length
        ? await prisma.team.findMany({
            where: { organizationId, id: { in: teamIds } },
            select: { id: true, name: true },
          })
        : [];
      const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
      const teamTransferHints = teamHintBase.map((h) => ({
        teamId: h.teamId,
        teamName: teamNameById.get(h.teamId) ?? h.teamId,
        instruction: h.instruction,
      }));

      const escRaw = behavior.escalationRules;
      const esc = escRaw && typeof escRaw === "object" ? (escRaw as Record<string, unknown>) : {};
      const escTeamId = typeof esc.transferTeamId === "string" ? esc.transferTeamId.trim() : "";
      const escTeamName = escTeamId ? teamNameById.get(escTeamId) ?? null : null;
      const escalation =
        escTeamId ||
        (typeof esc.keywords === "string" && esc.keywords.trim()) ||
        (typeof esc.conditions === "string" && esc.conditions.trim()) ||
        (typeof esc.transferMessage === "string" && esc.transferMessage.trim())
          ? {
              mode: typeof esc.mode === "string" ? esc.mode : "",
              targetTeamId: escTeamId || null,
              targetTeamName: escTeamName,
              keywords: typeof esc.keywords === "string" ? esc.keywords : "",
              conditions: typeof esc.conditions === "string" ? esc.conditions : "",
              transferMessage: typeof esc.transferMessage === "string" ? esc.transferMessage : "",
            }
          : null;

      const nativeTools = (() => {
        const n: Record<string, boolean> = {};
        const raw = behavior.nativeTools;
        if (raw && typeof raw === "object") {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === "boolean") n[k] = v;
          }
        }
        if (connectedTagInstructions.length > 0) {
          n.assign_contact_tags = true;
        }
        return n;
      })();

      const instructionFallbacks = parseInstructionFallbacks(pb.instructionFallbacks);
      const fbTeamIds = instructionFallbacks
        .filter((f) => f.action === "transfer_team" && f.teamId)
        .map((f) => f.teamId!);
      if (fbTeamIds.length) {
        const fbTeams = await prisma.team.findMany({
          where: { organizationId, id: { in: fbTeamIds } },
          select: { id: true, name: true },
        });
        const fbNameById = new Map(fbTeams.map((t) => [t.id, t.name]));
        for (const fb of instructionFallbacks) {
          if (fb.action === "transfer_team" && fb.teamId) {
            fb.teamName = fbNameById.get(fb.teamId) ?? fb.teamName ?? fb.teamId;
          }
        }
      }

      const autoInner = buildSyncedPromptAutoInstructionBlock({
        nativeTools,
        linkedArticleTitles: linkedTitles,
        connectedToolNames,
        connectedToolInstructions,
        connectedTagInstructions,
        teamTransferHints,
        escalation,
        instructionFallbacks,
      });

      const nextLlm = { ...llm, systemInstructions: mergeSystemWithAutoBlock(userCore, autoInner) };

      await prisma.automationAgentProfile.update({
        where: { botId: profile.botId },
        data: { llmConfig: asJson(nextLlm) },
      });

      await syncKnowledgeArticleBotsFromPromptBuilder({
        organizationId,
        botId: profile.botId,
        behaviorConfig: profile.behaviorConfig,
      });

      const refreshed = await prisma.automationAgentProfile.findFirst({
        where: { organizationId, botId: profile.botId },
        include: {
          bot: {
            select: { id: true, name: true, description: true, isActive: true, webhookUrl: true, config: true },
          },
        },
      });
      if (!refreshed) {
        return reply.status(404).send({ error: "Not Found", message: "Agent profile not found", statusCode: 404 });
      }
      const src = deriveBotAutomationSource({ webhookUrl: refreshed.bot.webhookUrl, config: refreshed.bot.config });
      const { bot: b, ...rest } = refreshed;
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
        llmConfig: redactLlmConfig(refreshed.llmConfig),
      };
    },
  );

  app.post<{ Params: { botId: string } }>(
    "/agent-profiles/:botId/test-chat",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = agentProfileTestChatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const profile = await prisma.automationAgentProfile.findFirst({
        where: { organizationId, botId: request.params.botId },
        include: { bot: true },
      });
      if (!profile) {
        return reply.status(404).send({ error: "Not Found", message: "Agent profile not found", statusCode: 404 });
      }

      const llm = (profile.llmConfig as Record<string, unknown>) ?? {};
      const provider = String(llm.provider ?? "openai");
      const model = String(llm.model ?? "gpt-4o-mini");
      const storedKey = String(llm.apiKey ?? "").trim();
      const apiKey =
        storedKey && storedKey !== "***"
          ? storedKey
          : provider === "openai"
            ? config.openAiPromptPreviewKey.trim()
            : provider === "google_gemini"
              ? config.geminiPromptPreviewKey.trim()
              : "";
      const history = parsed.data.history as PreviewChatTurn[];
      const userMessage = parsed.data.message;

      if (!apiKey) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "Agent API key not configured. Save a key in Automation > Agents IA or set OPENAI_API_KEY / OPENAI_PROMPT_PREVIEW_KEY (or GEMINI_PROMPT_PREVIEW_KEY) on the server.",
          statusCode: 400,
        });
      }

      if (provider === "google_gemini") {
        const system = String(llm.systemInstructions ?? "");
        const temperature = Number(llm.temperature ?? 0.7);
        const maxTokens = Number(llm.maxTokens ?? 1024);
        let systemEffective = system;
        const nativeFlags = parseNativeToolsFromBehavior(profile.behaviorConfig);
        if (nativeFlags.knowledge_search) {
          try {
            systemEffective =
              system +
              (await fetchProactiveKnowledgeSystemAppendix({
                organizationId,
                botId: profile.bot.id,
                userMessage,
                pinnedArticleIds: parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig),
                debugLog: request.log,
              }));
          } catch (err) {
            request.log.warn({ err, botId: profile.bot.id }, "test-chat proactive kb failed");
          }
        }
        try {
          const r = await callGeminiGenerateContent({
            apiKey,
            model,
            temperature: Number.isFinite(temperature) ? temperature : 0.7,
            maxTokens: Number.isFinite(maxTokens) ? Math.max(16, Math.min(8192, Math.trunc(maxTokens))) : 1024,
            system: systemEffective,
            history,
            userMessage,
            signal: AbortSignal.timeout(28_000),
          });
          return {
            botId: profile.bot.id,
            botName: profile.bot.name,
            provider,
            model,
            assistantMessage: (r.text ?? "").trim(),
            toolsUsed: false,
          };
        } catch (err) {
          const aborted = err instanceof Error && err.name === "AbortError";
          const msg = err instanceof Error ? err.message : "Agent test chat failed";
          return reply.status(aborted ? 504 : 502).send({
            error: aborted ? "Gateway Timeout" : "Bad Gateway",
            message: msg.slice(0, 1500),
            statusCode: aborted ? 504 : 502,
          });
        }
      }

      try {
        const { conversation } = await ensureAgentProfileTestSandbox(organizationId);
        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            type: "TEXT",
            body: userMessage,
          },
        });
        const assistantText = await generateNativeAgentReply({
          organizationId,
          bot: profile.bot,
          conversation,
          message,
          log: request.log,
          historyOverride: history,
        });

        return {
          botId: profile.bot.id,
          botName: profile.bot.name,
          provider,
          model,
          assistantMessage: (assistantText ?? "").trim(),
          toolsUsed: true,
        };
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        const msg = err instanceof Error ? err.message : "Agent test chat failed";
        return reply.status(aborted ? 504 : 502).send({
          error: aborted ? "Gateway Timeout" : "Bad Gateway",
          message: msg.slice(0, 1500),
          statusCode: aborted ? 504 : 502,
        });
      }
    },
  );

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
      const conversationId = request.params.conversationId;
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, organizationId },
        select: { id: true },
      });
      if (!conv) {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }
      const before = await prisma.automationConversationContext.findUnique({
        where: { conversationId },
        select: { id: true },
      });
      await clearAutomationConversationContext(organizationId, conversationId);
      if (before) {
        return { ok: true };
      }
      const after = await prisma.automationConversationContext.findUnique({
        where: { conversationId },
        select: { id: true },
      });
      if (!after) {
        return reply.status(404).send({
          error: "Not Found",
          message:
            "No automation context row yet and no organization agent bot (Settings). Nothing to clear; send one agent message first or configure the inbox bot.",
          statusCode: 404,
        });
      }
      return { ok: true, createdContextRow: true };
    },
  );

  await registerAutomationExecutionLogRoutes(app);
  await registerChatbotFlowRoutes(app);
}
