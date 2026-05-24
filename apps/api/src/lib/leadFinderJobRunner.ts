import type { FastifyInstance } from "fastify";
import type { LeadFinderSchedule } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import { searchGoogleMaps } from "./serpApiGoogleMaps.js";
import { importLeadFinderContacts } from "./leadFinderImport.js";
import { createLeadFinderFollowUp } from "./leadFinderFollowUp.js";
import { computeNextRunAt, parseFollowUpRecurrence } from "./broadcastRecurrence.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";

function buildSearchQuery(niche?: string | null, city?: string | null): string {
  const n = niche?.trim() ?? "";
  const c = city?.trim() ?? "";
  if (n && c) return `${n} em ${c}`;
  if (n) return n;
  if (c) return c;
  return "";
}

function shouldUseLocationParam(niche: string | undefined, city: string | undefined, q: string): string | undefined {
  const c = city?.trim();
  if (!c) return undefined;
  const n = niche?.trim();
  if (n && q.includes(c)) return undefined;
  if (q.includes(" em ") && q.includes(c)) return undefined;
  return c;
}

function mapLocalResult(r: {
  place_id?: string;
  title?: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string;
  rating?: number;
  type?: string;
}) {
  return {
    placeId: r.place_id ?? null,
    title: r.title ?? "",
    address: r.address ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    email: r.email ?? null,
    type: r.type ?? null,
    rating: typeof r.rating === "number" ? r.rating : null,
  };
}

export async function runLeadFinderScheduleJob(
  app: FastifyInstance,
  schedule: LeadFinderSchedule,
): Promise<{ ok: boolean; error?: string; stats?: Record<string, unknown> }> {
  const organizationId = schedule.organizationId;

  const enabled = await isOrganizationFeatureEnabled(organizationId, "lead_finder");
  if (!enabled) return { ok: false, error: "lead_finder_disabled" };

  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { leadFinderSerpApiKey: true },
  });
  const apiKey = decrypt(settings?.leadFinderSerpApiKey ?? null)?.trim();
  if (!apiKey) return { ok: false, error: "serp_api_not_configured" };

  let niche = schedule.niche;
  let city = schedule.city;
  if (schedule.searchMode === "segment" && schedule.segmentId) {
    const segment = await prisma.leadFinderSegment.findFirst({
      where: { id: schedule.segmentId, organizationId },
    });
    if (!segment) return { ok: false, error: "segment_not_found" };
    niche = segment.niche;
    city = segment.city;
  }

  const q = buildSearchQuery(niche, city);
  if (!q) return { ok: false, error: "empty_query" };

  let serpResults: ReturnType<typeof mapLocalResult>[] = [];
  try {
    const serp = await searchGoogleMaps({
      apiKey,
      q,
      location: shouldUseLocationParam(niche ?? undefined, city ?? undefined, q),
      start: 0,
      hl: "pt",
      gl: "br",
    });
    serpResults = serp.localResults.map(mapLocalResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "search_failed";
    return { ok: false, error: msg };
  }

  const importCfg = (schedule.importConfig ?? {}) as Record<string, unknown>;
  const tagIds = Array.isArray(importCfg.tagIds) ? (importCfg.tagIds as string[]) : [];
  const leadTypeId = typeof importCfg.leadTypeId === "string" ? importCfg.leadTypeId : null;
  const createImportTag = importCfg.createImportTag !== false;
  const updateExisting = importCfg.updateExisting !== false;
  const importTagName =
    typeof importCfg.importTagName === "string"
      ? importCfg.importTagName
      : `Lead Finder: ${q}`.slice(0, 100);

  const importResult = await importLeadFinderContacts(app, organizationId, {
    leads: serpResults,
    tagIds,
    leadTypeId,
    createImportTag,
    importTagName,
    updateExisting,
    createdById: schedule.createdById ?? undefined,
  });

  let followUpCampaignId: string | null = null;
  const followUpCfg = schedule.followUpConfig as Record<string, unknown> | null;
  if (followUpCfg && importResult.tagIds.length > 0) {
    const broadcastEnabled = await isOrganizationFeatureEnabled(organizationId, "broadcast_campaigns");
    if (broadcastEnabled) {
      const inboxId = typeof followUpCfg.inboxId === "string" ? followUpCfg.inboxId : "";
      const messageType = followUpCfg.messageType === "TEXT" ? "TEXT" : "TEMPLATE";
      const scheduleType =
        followUpCfg.scheduleType === "SCHEDULED" || followUpCfg.scheduleType === "RECURRING"
          ? followUpCfg.scheduleType
          : "IMMEDIATE";

      if (inboxId) {
        try {
          const fu = await createLeadFinderFollowUp(app, organizationId, {
            tagIds: importResult.tagIds,
            name:
              typeof followUpCfg.name === "string"
                ? followUpCfg.name
                : `Follow-up: ${q}`.slice(0, 200),
            inboxId,
            messageType,
            body: typeof followUpCfg.body === "string" ? followUpCfg.body : undefined,
            templateId: typeof followUpCfg.templateId === "string" ? followUpCfg.templateId : undefined,
            scheduleType,
            scheduledAt: typeof followUpCfg.scheduledAt === "string" ? followUpCfg.scheduledAt : undefined,
            segmentRules:
              followUpCfg.segmentRules && typeof followUpCfg.segmentRules === "object"
                ? (followUpCfg.segmentRules as Record<string, unknown>)
                : undefined,
            cronExpression: typeof followUpCfg.cronExpression === "string" ? followUpCfg.cronExpression : undefined,
            autoStart: followUpCfg.autoStart !== false && scheduleType === "IMMEDIATE",
            createdById: schedule.createdById ?? organizationId,
          });
          followUpCampaignId = fu.campaignId;
        } catch (err) {
          app.log.warn({ err, scheduleId: schedule.id }, "lead finder schedule follow-up failed");
        }
      }
    }
  }

  return {
    ok: true,
    stats: {
      query: q,
      found: serpResults.length,
      created: importResult.created,
      updated: importResult.updated,
      skipped: importResult.skipped,
      followUpCampaignId,
    },
  };
}

export function computeScheduleNextRunAt(
  schedule: Pick<LeadFinderSchedule, "scheduleType" | "scheduledAt" | "recurrence">,
  from: Date = new Date(),
): Date | null {
  if (schedule.scheduleType === "SCHEDULED" && schedule.scheduledAt) {
    return schedule.scheduledAt.getTime() > from.getTime() ? schedule.scheduledAt : null;
  }
  if (schedule.scheduleType === "RECURRING" && schedule.recurrence) {
    const recurrence = parseFollowUpRecurrence({ followUpRecurrence: schedule.recurrence });
    if (recurrence) return computeNextRunAt(from, recurrence);
  }
  return null;
}
