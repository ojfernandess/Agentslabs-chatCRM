import { prisma } from "../db.js";
import { isNvoipCallStatusActive } from "./nvoipCallTimeline.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { isWavoipCallStatusActive } from "./wavoipCallTimeline.js";

export type TelephonyProvider = "wavoip" | "nvoip" | "threecx";
type Granularity = "day" | "week" | "month";
type CallOutcome = "answered" | "missed" | "in_progress" | "other";

const MISSED_STATUSES = new Set([
  "NOT_ANSWERED",
  "REJECTED",
  "FAILED",
  "MISSED",
  "BUSY",
  "HANDLED_REMOTELY",
]);

type NormalizedCall = {
  provider: TelephonyProvider;
  direction: string;
  status: string;
  durationSec: number | null;
  endedAt: Date | null;
  recordUrl: string | null;
  initiatedByUserId: string | null;
  callAt: Date;
};

function classifyCallOutcome(call: NormalizedCall): CallOutcome {
  const s = call.status.toUpperCase();
  const dir = call.direction.toUpperCase();

  if (!call.endedAt) {
    if (
      (call.provider === "wavoip" && isWavoipCallStatusActive(s, dir)) ||
      (call.provider === "nvoip" && isNvoipCallStatusActive(s, dir)) ||
      (call.provider === "threecx" &&
        (s === "RINGING" || s === "ACTIVE" || s === "DIALING" || s === "CALLING"))
    ) {
      return "in_progress";
    }
  }

  if (MISSED_STATUSES.has(s)) return "missed";
  if (call.durationSec != null && call.durationSec > 0) return "answered";
  if (s === "ENDED" || s === "ANSWERED") {
    return dir === "INCOMING" && (call.durationSec == null || call.durationSec === 0)
      ? "missed"
      : "answered";
  }
  return "other";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtDurationSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type TelephonyReportsPayload = {
  enabled: boolean;
  providers: Record<TelephonyProvider, { enabled: boolean; hasData: boolean }>;
  summary: {
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    inProgressCalls: number;
    inboundAnswered: number;
    inboundMissed: number;
    answerRatePct: number | null;
    abandonRatePct: number | null;
    avgTalkTimeSec: number | null;
    totalTalkTimeSec: number;
    recordingsCount: number;
  };
  timeSeries: Array<{
    bucket: string;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
  }>;
  byProvider: Array<{
    provider: TelephonyProvider;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    avgTalkTimeSec: number | null;
  }>;
  agents: Array<{
    userId: string;
    name: string;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    totalTalkTimeSec: number;
    avgTalkTimeSec: number | null;
  }>;
  statusBreakdown: Array<{ status: string; count: number }>;
};

export async function buildTelephonyReports(input: {
  organizationId: string;
  from: Date;
  to: Date;
  granularity: Granularity;
}): Promise<TelephonyReportsPayload> {
  const { organizationId, from, to, granularity } = input;

  const [wavoipEnabled, nvoipEnabled, threeCxEnabled] = await Promise.all([
    isOrganizationFeatureEnabled(organizationId, "wavoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "nvoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "threecx_voice"),
  ]);

  const dateWhere = { gte: from, lte: to };
  const callSelect = {
    direction: true,
    status: true,
    durationSec: true,
    endedAt: true,
    recordUrl: true,
    initiatedByUserId: true,
    startedAt: true,
    createdAt: true,
  } as const;

  const [wavoipLogs, nvoipLogs, threeCxLogs, agentUsers] = await Promise.all([
    wavoipEnabled
      ? prisma.wavoipCallLog.findMany({
          where: {
            organizationId,
            createdAt: dateWhere,
            whatsappCallId: { gte: 0 },
          },
          select: callSelect,
        })
      : Promise.resolve([]),
    nvoipEnabled
      ? prisma.nvoipCallLog.findMany({
          where: { organizationId, createdAt: dateWhere },
          select: callSelect,
        })
      : Promise.resolve([]),
    threeCxEnabled
      ? prisma.threeCxCallLog.findMany({
          where: { organizationId, createdAt: dateWhere },
          select: callSelect,
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, displayName: true },
    }),
  ]);

  const agentNameById = new Map(
    agentUsers.map((u) => [u.id, u.displayName?.trim() || u.name]),
  );

  const normalized: NormalizedCall[] = [
    ...wavoipLogs.map((r) => ({
      provider: "wavoip" as const,
      direction: r.direction,
      status: r.status,
      durationSec: r.durationSec,
      endedAt: r.endedAt,
      recordUrl: r.recordUrl,
      initiatedByUserId: r.initiatedByUserId,
      callAt: r.startedAt ?? r.createdAt,
    })),
    ...nvoipLogs.map((r) => ({
      provider: "nvoip" as const,
      direction: r.direction,
      status: r.status,
      durationSec: r.durationSec,
      endedAt: r.endedAt,
      recordUrl: r.recordUrl,
      initiatedByUserId: r.initiatedByUserId,
      callAt: r.startedAt ?? r.createdAt,
    })),
    ...threeCxLogs.map((r) => ({
      provider: "threecx" as const,
      direction: r.direction,
      status: r.status,
      durationSec: r.durationSec,
      endedAt: r.endedAt,
      recordUrl: r.recordUrl,
      initiatedByUserId: r.initiatedByUserId,
      callAt: r.startedAt ?? r.createdAt,
    })),
  ];

  const bucketKey = (d: Date) => d.toISOString();

  type TsRow = {
    bucket: string;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
  };

  const tsMerge = new Map<string, TsRow>();
  const providerStats = new Map<
    TelephonyProvider,
    {
      total: number;
      inbound: number;
      outbound: number;
      answered: number;
      missed: number;
      talkSum: number;
      talkN: number;
    }
  >();
  const agentStats = new Map<
    string,
    {
      total: number;
      inbound: number;
      outbound: number;
      answered: number;
      missed: number;
      talkSum: number;
      talkN: number;
    }
  >();
  const statusCounts = new Map<string, number>();

  let totalCalls = 0;
  let inboundCalls = 0;
  let outboundCalls = 0;
  let answeredCalls = 0;
  let missedCalls = 0;
  let inProgressCalls = 0;
  let inboundAnswered = 0;
  let inboundMissed = 0;
  let totalTalkTimeSec = 0;
  let talkTimeN = 0;
  let recordingsCount = 0;

  const truncU = granularity === "month" ? "month" : granularity === "week" ? "week" : "day";

  for (const call of normalized) {
    totalCalls += 1;
    const dir = call.direction.toUpperCase();
    if (dir === "INCOMING") inboundCalls += 1;
    else if (dir === "OUTGOING") outboundCalls += 1;

    const outcome = classifyCallOutcome(call);
    if (outcome === "answered") {
      answeredCalls += 1;
      if (dir === "INCOMING") inboundAnswered += 1;
    } else if (outcome === "missed") {
      missedCalls += 1;
      if (dir === "INCOMING") inboundMissed += 1;
    } else if (outcome === "in_progress") {
      inProgressCalls += 1;
    }

    if (call.recordUrl?.trim()) recordingsCount += 1;
    if (call.durationSec != null && call.durationSec > 0) {
      totalTalkTimeSec += call.durationSec;
      talkTimeN += 1;
    }

    const statusKey = call.status.toUpperCase();
    statusCounts.set(statusKey, (statusCounts.get(statusKey) ?? 0) + 1);

    const bucketDate = new Date(call.callAt);
    bucketDate.setUTCHours(0, 0, 0, 0);
    if (truncU === "week") {
      const day = bucketDate.getUTCDay();
      bucketDate.setUTCDate(bucketDate.getUTCDate() - day);
    } else if (truncU === "month") {
      bucketDate.setUTCDate(1);
    }
    const bk = bucketKey(bucketDate);
    const ts = tsMerge.get(bk) ?? {
      bucket: bk,
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      answeredCalls: 0,
      missedCalls: 0,
    };
    ts.totalCalls += 1;
    if (dir === "INCOMING") ts.inboundCalls += 1;
    if (dir === "OUTGOING") ts.outboundCalls += 1;
    if (outcome === "answered") ts.answeredCalls += 1;
    if (outcome === "missed") ts.missedCalls += 1;
    tsMerge.set(bk, ts);

    const ps = providerStats.get(call.provider) ?? {
      total: 0,
      inbound: 0,
      outbound: 0,
      answered: 0,
      missed: 0,
      talkSum: 0,
      talkN: 0,
    };
    ps.total += 1;
    if (dir === "INCOMING") ps.inbound += 1;
    if (dir === "OUTGOING") ps.outbound += 1;
    if (outcome === "answered") ps.answered += 1;
    if (outcome === "missed") ps.missed += 1;
    if (call.durationSec != null && call.durationSec > 0) {
      ps.talkSum += call.durationSec;
      ps.talkN += 1;
    }
    providerStats.set(call.provider, ps);

    if (call.initiatedByUserId) {
      const as = agentStats.get(call.initiatedByUserId) ?? {
        total: 0,
        inbound: 0,
        outbound: 0,
        answered: 0,
        missed: 0,
        talkSum: 0,
        talkN: 0,
      };
      as.total += 1;
      if (dir === "INCOMING") as.inbound += 1;
      if (dir === "OUTGOING") as.outbound += 1;
      if (outcome === "answered") as.answered += 1;
      if (outcome === "missed") as.missed += 1;
      if (call.durationSec != null && call.durationSec > 0) {
        as.talkSum += call.durationSec;
        as.talkN += 1;
      }
      agentStats.set(call.initiatedByUserId, as);
    }
  }

  const inboundTerminal = inboundAnswered + inboundMissed;
  const answerRatePct =
    inboundTerminal > 0 ? round2((inboundAnswered / inboundTerminal) * 100) : null;
  const abandonRatePct =
    inboundTerminal > 0 ? round2((inboundMissed / inboundTerminal) * 100) : null;
  const avgTalkTimeSec = talkTimeN > 0 ? round2(totalTalkTimeSec / talkTimeN) : null;

  const enabled = wavoipEnabled || nvoipEnabled || threeCxEnabled;

  return {
    enabled,
    providers: {
      wavoip: { enabled: wavoipEnabled, hasData: wavoipLogs.length > 0 },
      nvoip: { enabled: nvoipEnabled, hasData: nvoipLogs.length > 0 },
      threecx: { enabled: threeCxEnabled, hasData: threeCxLogs.length > 0 },
    },
    summary: {
      totalCalls,
      inboundCalls,
      outboundCalls,
      answeredCalls,
      missedCalls,
      inProgressCalls,
      inboundAnswered,
      inboundMissed,
      answerRatePct,
      abandonRatePct,
      avgTalkTimeSec,
      totalTalkTimeSec,
      recordingsCount,
    },
    timeSeries: Array.from(tsMerge.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    byProvider: (["wavoip", "nvoip", "threecx"] as TelephonyProvider[])
      .filter((p) => providerStats.has(p))
      .map((provider) => {
        const p = providerStats.get(provider)!;
        return {
          provider,
          totalCalls: p.total,
          inboundCalls: p.inbound,
          outboundCalls: p.outbound,
          answeredCalls: p.answered,
          missedCalls: p.missed,
          avgTalkTimeSec: p.talkN > 0 ? round2(p.talkSum / p.talkN) : null,
        };
      }),
    agents: Array.from(agentStats.entries())
      .map(([userId, a]) => ({
        userId,
        name: agentNameById.get(userId) ?? userId,
        totalCalls: a.total,
        inboundCalls: a.inbound,
        outboundCalls: a.outbound,
        answeredCalls: a.answered,
        missedCalls: a.missed,
        totalTalkTimeSec: a.talkSum,
        avgTalkTimeSec: a.talkN > 0 ? round2(a.talkSum / a.talkN) : null,
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls),
    statusBreakdown: Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };
}

/** Exported for tests / CSV helpers */
export { fmtDurationSec };
