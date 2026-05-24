import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { decrypt } from "../lib/encryption.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { searchGoogleMaps, SerpApiError, type SerpMapsLocalResult } from "../lib/serpApiGoogleMaps.js";
import { importLeadFinderContacts } from "../lib/leadFinderImport.js";
import { createLeadFinderFollowUp } from "../lib/leadFinderFollowUp.js";
import { listLeadFinderSegments } from "../lib/leadFinderSegments.js";
import { buildCronFromRecurrence, computeNextRunAt, parseFollowUpRecurrence } from "../lib/broadcastRecurrence.js";

async function leadFinderGate(request: Parameters<typeof authenticate>[0], reply: Parameters<typeof authenticate>[1]): Promise<string | null> {
  await requireAdmin(request, reply);
  const organizationId = await resolveTenantOrganizationId(request, reply);
  if (!organizationId) return null;
  const enabled = await isOrganizationFeatureEnabled(organizationId, "lead_finder");
  if (!enabled) {
    reply.status(403).send({ error: "Forbidden", message: "Lead Finder is disabled for this organization", statusCode: 403 });
    return null;
  }
  return organizationId;
}

async function getSerpApiKey(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { leadFinderSerpApiKey: true },
  });
  const key = decrypt(settings?.leadFinderSerpApiKey ?? null);
  return key?.trim() || null;
}

function shouldUseLocationParam(body: { niche?: string; city?: string; query?: string }, q: string): string | undefined {
  const city = body.city?.trim();
  if (!city) return undefined;
  if (body.query?.trim()) return undefined;
  const niche = body.niche?.trim();
  if (niche && q.includes(city)) return undefined;
  if (q.includes(" em ") && q.includes(city)) return undefined;
  return city;
}

function mapSerpApiError(err: unknown): { status: number; message: string } {
  if (err instanceof SerpApiError) {
    const msg = err.message || "SerpApi search failed";
    const lower = msg.toLowerCase();
    if (err.httpStatus === 401 || lower.includes("invalid api key") || lower.includes("api key")) {
      return { status: 400, message: "Chave SerpApi inválida. Verifique em Configurações → Lead Finder." };
    }
    if (err.httpStatus === 429 || lower.includes("rate limit")) {
      return { status: 429, message: "Limite de pesquisas SerpApi atingido. Tente novamente em alguns minutos." };
    }
    return { status: 502, message: msg };
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { status: 504, message: "SerpApi demorou demais a responder. Tente novamente." };
  }
  if (err instanceof Error) {
    return { status: 502, message: err.message };
  }
  return { status: 502, message: "SerpApi search failed" };
}

function buildSearchQuery(body: { niche?: string; city?: string; query?: string }): string {
  const custom = body.query?.trim();
  if (custom) return custom;
  const niche = body.niche?.trim() ?? "";
  const city = body.city?.trim() ?? "";
  if (niche && city) return `${niche} em ${city}`;
  if (niche) return niche;
  if (city) return city;
  return "";
}

function mapLocalResult(r: SerpMapsLocalResult) {
  return {
    placeId: r.place_id ?? null,
    title: r.title ?? "",
    address: r.address ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    email: r.email ?? null,
    rating: typeof r.rating === "number" ? r.rating : null,
    reviews: typeof r.reviews === "number" ? r.reviews : null,
    type: r.type ?? (Array.isArray(r.types) ? r.types[0] : null),
    types: r.types ?? [],
    latitude: r.gps_coordinates?.latitude ?? null,
    longitude: r.gps_coordinates?.longitude ?? null,
    openState: r.open_state ?? null,
    description: r.description ?? null,
    unclaimedListing: r.unclaimed_listing === true,
  };
}

const searchSchema = z.object({
  niche: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  query: z.string().max(400).optional(),
  start: z.number().int().min(0).max(100).optional(),
  hl: z.string().max(8).optional(),
  gl: z.string().max(8).optional(),
});

const importLeadSchema = z.object({
  placeId: z.string().max(256).optional().nullable(),
  title: z.string().min(1).max(255),
  phone: z.string().max(64).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  type: z.string().max(200).optional().nullable(),
  rating: z.number().optional().nullable(),
});

const followUpBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  inboxId: z.string().uuid(),
  messageType: z.enum(["TEXT", "TEMPLATE"]),
  body: z.string().max(4096).optional(),
  templateId: z.string().uuid().optional(),
  scheduleType: z.enum(["IMMEDIATE", "SCHEDULED", "RECURRING"]).default("IMMEDIATE"),
  scheduledAt: z.string().datetime().optional(),
  segmentRules: z.record(z.unknown()).optional(),
  cronExpression: z.string().max(100).optional(),
  autoStart: z.boolean().optional(),
});

const importSchema = z.object({
  leads: z.array(importLeadSchema).min(1).max(100),
  tagIds: z.array(z.string().uuid()).optional(),
  leadTypeId: z.string().uuid().optional().nullable(),
  createImportTag: z.boolean().optional(),
  importTagName: z.string().max(100).optional(),
  updateExisting: z.boolean().optional(),
  followUp: followUpBodySchema.optional(),
});

const followUpSchema = followUpBodySchema.extend({
  tagIds: z.array(z.string().uuid()).min(1),
  name: z.string().min(1).max(200),
});

const segmentSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(1).max(200),
  city: z.string().min(1).max(200),
});

const importConfigSchema = z.object({
  tagIds: z.array(z.string().uuid()).optional(),
  leadTypeId: z.string().uuid().optional().nullable(),
  createImportTag: z.boolean().optional(),
  importTagName: z.string().max(100).optional(),
  updateExisting: z.boolean().optional(),
});

const scheduleSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  searchMode: z.enum(["custom", "segment"]),
  niche: z.string().max(200).optional(),
  city: z.string().max(200).optional(),
  segmentId: z.string().uuid().optional(),
  importConfig: importConfigSchema.default({}),
  scheduleType: z.enum(["SCHEDULED", "RECURRING"]),
  scheduledAt: z.string().datetime().optional(),
  recurrence: z.record(z.unknown()).optional(),
  cronExpression: z.string().max(100).optional(),
  timeZone: z.string().max(64).optional(),
  followUpConfig: followUpBodySchema.partial().optional().nullable(),
});

function resolveScheduleNextRun(
  scheduleType: "SCHEDULED" | "RECURRING",
  scheduledAt?: string,
  recurrence?: Record<string, unknown>,
  cronExpression?: string,
): { nextRunAt: Date | null; scheduledAtDate: Date | null; cron: string | null; recurrenceJson: object | null } {
  let scheduledAtDate = scheduledAt ? new Date(scheduledAt) : null;
  let cron = cronExpression ?? null;
  let recurrenceJson: object | null = recurrence ? (recurrence as object) : null;
  let nextRunAt: Date | null = null;

  if (scheduleType === "SCHEDULED" && scheduledAtDate) {
    nextRunAt = scheduledAtDate;
  } else if (scheduleType === "RECURRING" && recurrence) {
    const parsed = parseFollowUpRecurrence({ followUpRecurrence: recurrence });
    if (parsed) {
      if (!cron) cron = buildCronFromRecurrence(parsed);
      nextRunAt = computeNextRunAt(new Date(), parsed);
      scheduledAtDate = scheduledAtDate ?? nextRunAt;
      recurrenceJson = parsed as object;
    }
  }

  return { nextRunAt, scheduledAtDate, cron, recurrenceJson };
}

async function validateFollowUpInput(
  organizationId: string,
  d: z.infer<typeof followUpBodySchema> & { name?: string },
): Promise<string | null> {
  if (d.messageType === "TEXT" && !d.body?.trim()) return "body is required for TEXT";
  if (d.messageType === "TEMPLATE" && !d.templateId) return "templateId is required for TEMPLATE";
  const inbox = await prisma.inbox.findFirst({ where: { id: d.inboxId, organizationId } });
  if (!inbox) return "Invalid inboxId";
  return null;
}

export async function leadFinderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/status", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const apiKey = await getSerpApiKey(organizationId);
    return {
      enabled: true,
      configured: Boolean(apiKey),
      serpApiDocsUrl: "https://serpapi.com/google-maps-api",
    };
  });

  app.get("/segments", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const segments = await listLeadFinderSegments(organizationId);
    return { segments };
  });

  app.post("/segments", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const parsed = segmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    try {
      const segment = await prisma.leadFinderSegment.create({
        data: { organizationId, ...parsed.data, isPreset: false },
      });
      return reply.status(201).send({ segment });
    } catch {
      return reply.status(400).send({ error: "Bad Request", message: "Segmento com este nome já existe.", statusCode: 400 });
    }
  });

  app.patch("/segments/:id", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const parsed = segmentSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.leadFinderSegment.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Segment not found", statusCode: 404 });
    }
    try {
      const segment = await prisma.leadFinderSegment.update({
        where: { id },
        data: parsed.data,
      });
      return { segment };
    } catch {
      return reply.status(400).send({ error: "Bad Request", message: "Segmento com este nome já existe.", statusCode: 400 });
    }
  });

  app.delete("/segments/:id", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const existing = await prisma.leadFinderSegment.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Segment not found", statusCode: 404 });
    }
    await prisma.leadFinderSegment.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/schedules", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const schedules = await prisma.leadFinderSchedule.findMany({
      where: { organizationId },
      include: { segment: { select: { id: true, name: true, niche: true, city: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { schedules };
  });

  app.post("/schedules", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const parsed = scheduleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const d = parsed.data;
    if (d.searchMode === "segment" && !d.segmentId) {
      return reply.status(400).send({ error: "Bad Request", message: "segmentId required for segment mode", statusCode: 400 });
    }
    if (d.searchMode === "custom" && !d.niche?.trim() && !d.city?.trim()) {
      return reply.status(400).send({ error: "Bad Request", message: "Informe nicho ou cidade.", statusCode: 400 });
    }
    if (d.followUpConfig?.inboxId) {
      const err = await validateFollowUpInput(organizationId, d.followUpConfig as z.infer<typeof followUpBodySchema>);
      if (err) return reply.status(400).send({ error: "Bad Request", message: err, statusCode: 400 });
    }

    const { nextRunAt, scheduledAtDate, cron, recurrenceJson } = resolveScheduleNextRun(
      d.scheduleType,
      d.scheduledAt,
      d.recurrence,
      d.cronExpression,
    );
    if (!nextRunAt) {
      return reply.status(400).send({ error: "Bad Request", message: "Horário de execução inválido.", statusCode: 400 });
    }

    const schedule = await prisma.leadFinderSchedule.create({
      data: {
        organizationId,
        name: d.name,
        enabled: d.enabled ?? true,
        searchMode: d.searchMode,
        niche: d.niche?.trim() || null,
        city: d.city?.trim() || null,
        segmentId: d.segmentId ?? null,
        importConfig: d.importConfig as object,
        scheduleType: d.scheduleType,
        scheduledAt: scheduledAtDate,
        recurrence: recurrenceJson ?? undefined,
        cronExpression: cron,
        nextRunAt,
        timeZone: d.timeZone ?? null,
        followUpConfig: d.followUpConfig ? (d.followUpConfig as object) : undefined,
        createdById: request.user.id,
      },
      include: { segment: { select: { id: true, name: true, niche: true, city: true } } },
    });
    return reply.status(201).send({ schedule });
  });

  app.patch("/schedules/:id", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const parsed = scheduleSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.leadFinderSchedule.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Schedule not found", statusCode: 404 });
    }
    const d = parsed.data;
    if (d.followUpConfig?.inboxId) {
      const err = await validateFollowUpInput(organizationId, d.followUpConfig as z.infer<typeof followUpBodySchema>);
      if (err) return reply.status(400).send({ error: "Bad Request", message: err, statusCode: 400 });
    }

    const scheduleType = d.scheduleType ?? existing.scheduleType;
    const scheduledAtStr = d.scheduledAt ?? existing.scheduledAt?.toISOString();
    const recurrence = d.recurrence ?? (existing.recurrence as Record<string, unknown> | undefined);
    const cronExpr = d.cronExpression ?? existing.cronExpression ?? undefined;

    let nextRunAt = existing.nextRunAt;
    if (d.scheduleType || d.scheduledAt || d.recurrence || d.cronExpression) {
      const resolved = resolveScheduleNextRun(scheduleType, scheduledAtStr, recurrence, cronExpr);
      nextRunAt = resolved.nextRunAt;
    }

    const schedule = await prisma.leadFinderSchedule.update({
      where: { id },
      data: {
        ...(d.name != null ? { name: d.name } : {}),
        ...(d.enabled != null ? { enabled: d.enabled } : {}),
        ...(d.searchMode != null ? { searchMode: d.searchMode } : {}),
        ...(d.niche !== undefined ? { niche: d.niche?.trim() || null } : {}),
        ...(d.city !== undefined ? { city: d.city?.trim() || null } : {}),
        ...(d.importConfig != null ? { importConfig: d.importConfig as object } : {}),
        ...(d.scheduleType != null ? { scheduleType: d.scheduleType } : {}),
        ...(d.scheduledAt != null ? { scheduledAt: new Date(d.scheduledAt) } : {}),
        ...(d.recurrence != null ? { recurrence: d.recurrence as object } : {}),
        ...(d.cronExpression !== undefined ? { cronExpression: d.cronExpression } : {}),
        ...(d.timeZone !== undefined ? { timeZone: d.timeZone } : {}),
        ...(d.followUpConfig !== undefined
          ? { followUpConfig: d.followUpConfig === null ? Prisma.JsonNull : (d.followUpConfig as Prisma.InputJsonValue) }
          : {}),
        nextRunAt,
        ...(d.segmentId !== undefined
          ? { segment: d.segmentId ? { connect: { id: d.segmentId } } : { disconnect: true } }
          : {}),
      },
      include: { segment: { select: { id: true, name: true, niche: true, city: true } } },
    });
    return { schedule };
  });

  app.delete("/schedules/:id", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const existing = await prisma.leadFinderSchedule.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Schedule not found", statusCode: 404 });
    }
    await prisma.leadFinderSchedule.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/search", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;

    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const q = buildSearchQuery(parsed.data);
    if (!q) {
      return reply.status(400).send({ error: "Bad Request", message: "Informe nicho, cidade ou consulta.", statusCode: 400 });
    }

    const apiKey = await getSerpApiKey(organizationId);
    if (!apiKey) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Configure a chave SerpApi em Configurações → Lead Finder.",
        statusCode: 400,
      });
    }

    try {
      const serp = await searchGoogleMaps({
        apiKey,
        q,
        location: shouldUseLocationParam(parsed.data, q),
        start: parsed.data.start ?? 0,
        hl: parsed.data.hl ?? "pt",
        gl: parsed.data.gl ?? "br",
      });

      const results = serp.localResults.map(mapLocalResult);
      const start = parsed.data.start ?? 0;
      const nextStart =
        serp.paginationNext && results.length > 0 ? start + results.length : null;

      return {
        query: q,
        results,
        localResultsState: serp.localResultsState,
        nextStart: nextStart != null && nextStart <= 100 ? nextStart : null,
      };
    } catch (err) {
      const mapped = mapSerpApiError(err);
      app.log.warn({ err, organizationId, query: q }, "lead finder search failed");
      return reply.status(mapped.status).send({ error: "Bad Gateway", message: mapped.message, statusCode: mapped.status });
    }
  });

  app.post("/import", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;

    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const d = parsed.data;

    if (d.followUp) {
      const broadcastEnabled = await isOrganizationFeatureEnabled(organizationId, "broadcast_campaigns");
      if (!broadcastEnabled) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Campanhas de envio estão desativadas para esta organização.",
          statusCode: 403,
        });
      }
      const err = await validateFollowUpInput(organizationId, d.followUp);
      if (err) return reply.status(400).send({ error: "Bad Request", message: err, statusCode: 400 });
    }

    try {
      const result = await importLeadFinderContacts(app, organizationId, {
        leads: d.leads,
        tagIds: d.tagIds,
        leadTypeId: d.leadTypeId,
        createImportTag: d.createImportTag,
        importTagName: d.importTagName,
        updateExisting: d.updateExisting,
        createdById: request.user.id,
      });

      let followUp: { campaignId: string; started: boolean; startError: string | null } | null = null;
      if (d.followUp && result.tagIds.length > 0) {
        const fuName =
          d.followUp.name?.trim() ||
          (d.importTagName ? `Follow-up: ${d.importTagName}` : "Follow-up Lead Finder");
        followUp = await createLeadFinderFollowUp(app, organizationId, {
          tagIds: result.tagIds,
          name: fuName.slice(0, 200),
          inboxId: d.followUp.inboxId,
          messageType: d.followUp.messageType,
          body: d.followUp.body,
          templateId: d.followUp.templateId,
          scheduleType: d.followUp.scheduleType,
          scheduledAt: d.followUp.scheduledAt,
          segmentRules: d.followUp.segmentRules,
          cronExpression: d.followUp.cronExpression,
          autoStart: d.followUp.autoStart,
          createdById: request.user.id,
        });
      }

      return { ...result, followUp };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }
  });

  app.post("/create-follow-up", async (request, reply) => {
    const organizationId = await leadFinderGate(request, reply);
    if (!organizationId) return;

    const broadcastEnabled = await isOrganizationFeatureEnabled(organizationId, "broadcast_campaigns");
    if (!broadcastEnabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Campanhas de envio estão desativadas para esta organização.",
        statusCode: 403,
      });
    }

    const parsed = followUpSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const d = parsed.data;
    const err = await validateFollowUpInput(organizationId, d);
    if (err) return reply.status(400).send({ error: "Bad Request", message: err, statusCode: 400 });

    const tagCount = await prisma.tag.count({ where: { organizationId, id: { in: d.tagIds } } });
    if (tagCount !== d.tagIds.length) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid tagIds", statusCode: 400 });
    }

    const result = await createLeadFinderFollowUp(app, organizationId, {
      ...d,
      createdById: request.user.id,
    });
    return reply.status(201).send(result);
  });
}
