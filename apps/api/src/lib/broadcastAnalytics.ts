import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { parseSegmentRules } from "./broadcastTypes.js";
import {
  classifyBroadcastError,
  groupErrorsByCategory,
  type BroadcastErrorCategory,
} from "./broadcastErrorClassifier.js";
import {
  type ParsedAnalyticsQuery,
  resolveAnalyticsDateRange,
} from "./broadcastAnalyticsQuery.js";

const CHART_MAX_ROWS = 25_000;
const ERROR_AGG_MAX_ROWS = 15_000;

export interface BroadcastAnalyticsPayload {
  summary: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    deliveryRate: number | null;
    errorRate: number | null;
    engagementRate: number | null;
    responded: number;
    opened: number;
  };
  filters: {
    from: string;
    to: string;
    campaignKind: string;
    status: string;
    channel: string | null;
    search: string | null;
    campaignId: string | null;
  };
  sendByDay: { date: string; sent: number; failed: number }[];
  ratesByDay: { date: string; deliveryRate: number | null; errorRate: number | null; engagementRate: number | null }[];
  topCampaigns: {
    id: string;
    name: string;
    status: string;
    channel: string;
    campaignKind: string | null;
    sentCount: number;
    failedCount: number;
    totalRecipients: number;
    deliveryRate: number | null;
  }[];
  errorSpikeAlert: {
    active: boolean;
    failedLast24h: number;
    baselineDaily: number;
    messageKey: string;
  } | null;
  errorsByCategory: {
    category: BroadcastErrorCategory;
    count: number;
    sampleMessage: string | null;
    affectedPhones: string[];
  }[];
  sendLog: {
    items: {
      id: string;
      sentAt: string | null;
      createdAt: string;
      status: string;
      channel: string;
      campaignId: string;
      campaignName: string;
      campaignKind: string | null;
      contactId: string;
      contactName: string | null;
      phone: string | null;
      email: string | null;
      error: string | null;
      errorCategory: BroadcastErrorCategory | null;
      openedAt: string | null;
      respondedAt: string | null;
    }[];
    total: number;
    page: number;
    pageSize: number;
  };
}

function campaignKindFromSegmentRules(segmentRules: unknown): string | null {
  return parseSegmentRules(segmentRules)?.campaignKind ?? null;
}

export function buildCampaignFilterForAnalytics(
  organizationId: string,
  query: ParsedAnalyticsQuery,
): Prisma.BroadcastCampaignWhereInput {
  const where: Prisma.BroadcastCampaignWhereInput = { organizationId };
  if (query.channel) where.channel = query.channel;
  if (query.campaignId) where.id = query.campaignId;
  if (query.campaignKind === "followup") {
    where.segmentRules = { path: ["campaignKind"], equals: "followup" };
  } else if (query.campaignKind !== "all") {
    where.segmentRules = { path: ["campaignKind"], equals: query.campaignKind };
  }
  return where;
}

export function buildRecipientWhereForAnalytics(
  organizationId: string,
  query: ParsedAnalyticsQuery,
  range: { from: Date; to: Date },
): Prisma.BroadcastCampaignRecipientWhereInput {
  const campaignWhere = buildCampaignFilterForAnalytics(organizationId, query);
  const where: Prisma.BroadcastCampaignRecipientWhereInput = {
    campaign: campaignWhere,
    OR: [
      { sentAt: { gte: range.from, lte: range.to } },
      {
        sentAt: null,
        createdAt: { gte: range.from, lte: range.to },
      },
    ],
  };
  if (query.status !== "ALL") {
    where.status = query.status;
  }
  const search = query.search?.trim();
  if (search) {
    where.AND = [
      {
        OR: [
          { contact: { phone: { contains: search, mode: "insensitive" } } },
          { contact: { name: { contains: search, mode: "insensitive" } } },
          { contact: { email: { contains: search, mode: "insensitive" } } },
          { campaign: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
    ];
  }
  return where;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function initDayMap(from: Date, to: Date): Map<string, { sent: number; failed: number; responded: number; opened: number }> {
  const map = new Map<string, { sent: number; failed: number; responded: number; opened: number }>();
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    map.set(cursor.toISOString().slice(0, 10), { sent: 0, failed: 0, responded: 0, opened: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

export async function detectBroadcastErrorSpike(
  organizationId: string,
): Promise<BroadcastAnalyticsPayload["errorSpikeAlert"]> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [failedLast24h, failedWeek] = await Promise.all([
    prisma.broadcastCampaignRecipient.count({
      where: {
        campaign: { organizationId },
        status: "FAILED",
        OR: [{ sentAt: { gte: dayAgo } }, { createdAt: { gte: dayAgo } }],
      },
    }),
    prisma.broadcastCampaignRecipient.count({
      where: {
        campaign: { organizationId },
        status: "FAILED",
        OR: [{ sentAt: { gte: weekAgo } }, { createdAt: { gte: weekAgo } }],
      },
    }),
  ]);

  const baselineDaily = failedWeek / 7;
  const threshold = Math.max(10, baselineDaily * 1.5);
  if (failedLast24h >= threshold && failedLast24h > baselineDaily) {
    return {
      active: true,
      failedLast24h,
      baselineDaily: Math.round(baselineDaily * 10) / 10,
      messageKey: "broadcastPage.analyticsErrorSpike",
    };
  }
  return null;
}

export async function buildBroadcastAnalytics(
  organizationId: string,
  query: ParsedAnalyticsQuery,
): Promise<BroadcastAnalyticsPayload> {
  const range = resolveAnalyticsDateRange(query);
  const where = buildRecipientWhereForAnalytics(organizationId, query, range);

  const skip = (query.page - 1) * query.pageSize;

  const [
    total,
    sent,
    failed,
    pending,
    responded,
    opened,
    sendLogRows,
    chartRows,
    errorRows,
    campaigns,
    errorSpikeAlert,
  ] = await Promise.all([
    prisma.broadcastCampaignRecipient.count({ where }),
    prisma.broadcastCampaignRecipient.count({ where: { ...where, status: "SENT" } }),
    prisma.broadcastCampaignRecipient.count({ where: { ...where, status: "FAILED" } }),
    prisma.broadcastCampaignRecipient.count({ where: { ...where, status: "PENDING" } }),
    prisma.broadcastCampaignRecipient.count({
      where: { ...where, status: "SENT", respondedAt: { not: null } },
    }),
    prisma.broadcastCampaignRecipient.count({
      where: { ...where, status: "SENT", openedAt: { not: null } },
    }),
    prisma.broadcastCampaignRecipient.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true } },
        campaign: { select: { id: true, name: true, channel: true, segmentRules: true, status: true } },
      },
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
    prisma.broadcastCampaignRecipient.findMany({
      where,
      select: { status: true, sentAt: true, createdAt: true, openedAt: true, respondedAt: true },
      take: CHART_MAX_ROWS,
    }),
    prisma.broadcastCampaignRecipient.findMany({
      where: { ...where, status: "FAILED", error: { not: null } },
      select: {
        error: true,
        contact: { select: { phone: true } },
      },
      take: ERROR_AGG_MAX_ROWS,
    }),
    prisma.broadcastCampaign.findMany({
      where: buildCampaignFilterForAnalytics(organizationId, query),
      select: {
        id: true,
        name: true,
        status: true,
        channel: true,
        segmentRules: true,
        sentCount: true,
        failedCount: true,
        totalRecipients: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    detectBroadcastErrorSpike(organizationId),
  ]);

  const attempted = sent + failed;
  const dayMap = initDayMap(range.from, range.to);

  for (const r of chartRows) {
    const day = (r.sentAt ?? r.createdAt).toISOString().slice(0, 10);
    if (!dayMap.has(day)) continue;
    const bucket = dayMap.get(day)!;
    if (r.status === "SENT") {
      bucket.sent += 1;
      if (r.respondedAt) bucket.responded += 1;
      if (r.openedAt) bucket.opened += 1;
    } else if (r.status === "FAILED") {
      bucket.failed += 1;
    }
  }

  const sendByDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, sent: v.sent, failed: v.failed }));

  const ratesByDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const att = v.sent + v.failed;
      return {
        date,
        deliveryRate: pct(v.sent, att),
        errorRate: pct(v.failed, att),
        engagementRate: pct(v.responded, v.sent),
      };
    });

  const topCampaigns = campaigns
    .filter((c) => c.sentCount > 0 || c.failedCount > 0)
    .sort((a, b) => b.sentCount + b.failedCount - (a.sentCount + a.failedCount))
    .slice(0, 8)
    .map((c) => {
      const att = c.sentCount + c.failedCount;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        channel: c.channel,
        campaignKind: campaignKindFromSegmentRules(c.segmentRules),
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        totalRecipients: c.totalRecipients,
        deliveryRate: pct(c.sentCount, att),
      };
    });

  return {
    summary: {
      total,
      sent,
      failed,
      pending,
      deliveryRate: pct(sent, attempted),
      errorRate: pct(failed, attempted),
      engagementRate: pct(responded, sent),
      responded,
      opened,
    },
    filters: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      campaignKind: query.campaignKind,
      status: query.status,
      channel: query.channel ?? null,
      search: query.search?.trim() ?? null,
      campaignId: query.campaignId ?? null,
    },
    sendByDay,
    ratesByDay,
    topCampaigns,
    errorSpikeAlert,
    errorsByCategory: groupErrorsByCategory(
      errorRows.map((r) => ({ error: r.error, phone: r.contact.phone })),
    ),
    sendLog: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: sendLogRows.map((r) => {
        const cat = r.status === "FAILED" ? classifyBroadcastError(r.error).category : null;
        return {
          id: r.id,
          sentAt: r.sentAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          status: r.status,
          channel: r.campaign.channel,
          campaignId: r.campaign.id,
          campaignName: r.campaign.name,
          campaignKind: campaignKindFromSegmentRules(r.campaign.segmentRules),
          contactId: r.contact.id,
          contactName: r.contact.name,
          phone: r.contact.phone,
          email: r.contact.email,
          error: r.error,
          errorCategory: cat,
          openedAt: r.openedAt?.toISOString() ?? null,
          respondedAt: r.respondedAt?.toISOString() ?? null,
        };
      }),
    },
  };
}

export function buildAnalyticsExportCsv(rows: BroadcastAnalyticsPayload["sendLog"]["items"]): string {
  const header = [
    "sentAt",
    "campaignName",
    "campaignKind",
    "channel",
    "contactName",
    "phone",
    "email",
    "status",
    "error",
    "errorCategory",
    "respondedAt",
    "openedAt",
  ];
  const escape = (v: string | null | undefined) => {
    const s = v ?? "";
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.sentAt ?? r.createdAt,
        r.campaignName,
        r.campaignKind ?? "",
        r.channel,
        r.contactName ?? "",
        r.phone ?? "",
        r.email ?? "",
        r.status,
        r.error ?? "",
        r.errorCategory ?? "",
        r.respondedAt ?? "",
        r.openedAt ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function fetchAnalyticsExportRows(
  organizationId: string,
  query: ParsedAnalyticsQuery,
  maxRows = 10_000,
): Promise<BroadcastAnalyticsPayload["sendLog"]["items"]> {
  const range = resolveAnalyticsDateRange(query);
  const where = buildRecipientWhereForAnalytics(organizationId, query, range);
  const rows = await prisma.broadcastCampaignRecipient.findMany({
    where,
    include: {
      contact: { select: { id: true, name: true, phone: true, email: true } },
      campaign: { select: { id: true, name: true, channel: true, segmentRules: true, status: true } },
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    take: maxRows,
  });

  return rows.map((r) => {
    const cat = r.status === "FAILED" ? classifyBroadcastError(r.error).category : null;
    return {
      id: r.id,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      channel: r.campaign.channel,
      campaignId: r.campaign.id,
      campaignName: r.campaign.name,
      campaignKind: campaignKindFromSegmentRules(r.campaign.segmentRules),
      contactId: r.contact.id,
      contactName: r.contact.name,
      phone: r.contact.phone,
      email: r.contact.email,
      error: r.error,
      errorCategory: cat,
      openedAt: r.openedAt?.toISOString() ?? null,
      respondedAt: r.respondedAt?.toISOString() ?? null,
    };
  });
}
