import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { decrypt } from "../lib/encryption.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { searchGoogleMaps, SerpApiError, type SerpMapsLocalResult } from "../lib/serpApiGoogleMaps.js";
import { normalizeLeadFinderPhone } from "../lib/leadFinderPhone.js";
import { ensurePipelineStageForLeadType } from "../lib/pipelineLeadTypeSync.js";
import { fireBroadcastEventTriggers } from "../lib/broadcastEventHooks.js";
import { materializeAndStartCampaign } from "../lib/broadcastCampaignStart.js";
import { parseSegmentRules } from "../lib/broadcastTypes.js";
import { computeNextRunAt, parseFollowUpRecurrence } from "../lib/broadcastRecurrence.js";

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

function contactNotesFromLead(lead: {
  address?: string | null;
  website?: string | null;
  placeId?: string | null;
  type?: string | null;
  rating?: number | null;
}): string {
  const lines: string[] = ["[Lead Finder]"];
  if (lead.type) lines.push(`Tipo: ${lead.type}`);
  if (lead.address) lines.push(`Endereço: ${lead.address}`);
  if (lead.website) lines.push(`Site: ${lead.website}`);
  if (lead.placeId) lines.push(`Google Place ID: ${lead.placeId}`);
  if (lead.rating != null) lines.push(`Avaliação: ${lead.rating}`);
  return lines.join("\n");
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

const importSchema = z.object({
  leads: z.array(importLeadSchema).min(1).max(100),
  tagIds: z.array(z.string().uuid()).optional(),
  leadTypeId: z.string().uuid().optional().nullable(),
  createImportTag: z.boolean().optional(),
  importTagName: z.string().max(100).optional(),
  updateExisting: z.boolean().optional(),
});

const followUpSchema = z.object({
  tagIds: z.array(z.string().uuid()).min(1),
  name: z.string().min(1).max(200),
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
    let tagIds = [...(d.tagIds ?? [])];

    if (d.createImportTag) {
      const tagName = (d.importTagName?.trim() || `Lead Finder ${new Date().toISOString().slice(0, 10)}`).slice(0, 100);
      const existingTag = await prisma.tag.findFirst({ where: { organizationId, name: tagName } });
      if (existingTag) {
        if (!tagIds.includes(existingTag.id)) tagIds.push(existingTag.id);
      } else {
        const created = await prisma.tag.create({
          data: { organizationId, name: tagName, color: "#6366f1" },
        });
        tagIds.push(created.id);
      }
    }

    if (d.leadTypeId) {
      const lt = await prisma.leadType.findFirst({ where: { id: d.leadTypeId, organizationId } });
      if (!lt) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid leadTypeId", statusCode: 400 });
      }
    }

    if (tagIds.length > 0) {
      const count = await prisma.tag.count({ where: { organizationId, id: { in: tagIds } } });
      if (count !== tagIds.length) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid tagIds", statusCode: 400 });
      }
    }

    let pipelineStageId: string | null = null;
    if (d.leadTypeId) {
      const stage = await ensurePipelineStageForLeadType(prisma, organizationId, d.leadTypeId);
      pipelineStageId = stage.id;
    }

    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const skipped: { title: string; reason: string }[] = [];

    for (const lead of d.leads) {
      const phone = normalizeLeadFinderPhone(lead.phone ?? "");
      if (!phone) {
        skipped.push({ title: lead.title, reason: "no_phone" });
        continue;
      }

      const notes = contactNotesFromLead(lead);
      const existing = await prisma.contact.findFirst({ where: { organizationId, phone } });

      if (existing) {
        if (!d.updateExisting) {
          skipped.push({ title: lead.title, reason: "duplicate" });
          continue;
        }
        const updated = await prisma.contact.update({
          where: { id: existing.id },
          data: {
            name: lead.title,
            notes: existing.notes ? `${existing.notes}\n\n${notes}` : notes,
            ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
            ...(pipelineStageId ? { pipelineStageId } : {}),
          },
        });
        if (tagIds.length > 0) {
          await prisma.contactTag.createMany({
            data: tagIds.map((tagId) => ({ contactId: updated.id, tagId })),
            skipDuplicates: true,
          });
        }
        updatedIds.push(updated.id);
        continue;
      }

      const contact = await prisma.contact.create({
        data: {
          organizationId,
          phone,
          name: lead.title,
          notes,
          email: lead.email?.trim() || null,
          pipelineStageId,
          createdById: request.user.id,
          tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
      });
      createdIds.push(contact.id);
      fireBroadcastEventTriggers(app, organizationId, "NEW_LEAD", { contactId: contact.id });
    }

    return {
      created: createdIds.length,
      updated: updatedIds.length,
      skipped: skipped.length,
      skippedDetails: skipped,
      contactIds: [...createdIds, ...updatedIds],
      tagIds,
    };
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
  if (d.messageType === "TEXT" && !d.body?.trim()) {
      return reply.status(400).send({ error: "Bad Request", message: "body is required for TEXT", statusCode: 400 });
    }
    if (d.messageType === "TEMPLATE" && !d.templateId) {
      return reply.status(400).send({ error: "Bad Request", message: "templateId is required for TEMPLATE", statusCode: 400 });
    }

    const inbox = await prisma.inbox.findFirst({ where: { id: d.inboxId, organizationId } });
    if (!inbox) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid inboxId", statusCode: 400 });
    }

    const tagCount = await prisma.tag.count({ where: { organizationId, id: { in: d.tagIds } } });
    if (tagCount !== d.tagIds.length) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid tagIds", statusCode: 400 });
    }

    const segmentRules = {
      tagLogic: "ANY" as const,
      campaignKind: "followup" as const,
      ...(parseSegmentRules(d.segmentRules) ?? {}),
    };

    let scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
    let cronExpression = d.cronExpression ?? null;
    let nextRunAt: Date | null = null;

    if (d.scheduleType === "SCHEDULED" && scheduledAt) {
      nextRunAt = scheduledAt;
    } else if (d.scheduleType === "RECURRING") {
      const recurrence = parseFollowUpRecurrence(segmentRules);
      if (recurrence) {
        nextRunAt = computeNextRunAt(new Date(), recurrence);
        scheduledAt = scheduledAt ?? nextRunAt;
      }
    }

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        organizationId,
        name: d.name,
        channel: "WHATSAPP",
        inboxId: d.inboxId,
        messageType: d.messageType,
        body: d.messageType === "TEXT" ? d.body?.trim() : null,
        templateId: d.messageType === "TEMPLATE" ? d.templateId : null,
        segmentRules: segmentRules as object,
        scheduleType: d.scheduleType,
        scheduledAt,
        cronExpression,
        nextRunAt,
        status: "DRAFT",
        createdById: request.user.id,
        tags: { create: d.tagIds.map((tagId) => ({ tagId })) },
      },
    });

    let started = false;
    let startError: string | null = null;
    if (d.autoStart === true && d.scheduleType === "IMMEDIATE") {
      try {
        await materializeAndStartCampaign(app, organizationId, campaign.id);
        started = true;
      } catch (err) {
        startError = err instanceof Error ? err.message : "Start failed";
      }
    }

    return reply.status(201).send({ campaignId: campaign.id, started, startError });
  });
}
