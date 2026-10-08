import { prisma } from "../db.js";
import { isNvoipCallStatusActive } from "./nvoipCallTimeline.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { isWavoipCallStatusActive } from "./wavoipCallTimeline.js";

export type TelephonyProvider = "wavoip" | "nvoip" | "threecx" | "sip";
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
  const dir = normalizeCallDirection(call.direction);

  if (!call.endedAt) {
    if (
      (call.provider === "wavoip" && isWavoipCallStatusActive(s, dir)) ||
      (call.provider === "nvoip" && isNvoipCallStatusActive(s, dir)) ||
      (call.provider === "threecx" &&
        (s === "RINGING" || s === "ACTIVE" || s === "DIALING" || s === "CALLING")) ||
      (call.provider === "sip" && (s === "RINGING" || s === "ACTIVE"))
    ) {
      return "in_progress";
    }
  }

  if (MISSED_STATUSES.has(s)) return "missed";
  if (call.provider === "sip" && (s === "ENDED" || s === "ANSWERED")) return "answered";
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

function normalizeCallDirection(direction: string): "INCOMING" | "OUTGOING" | "UNKNOWN" {
  const d = direction.trim().toUpperCase();
  if (d === "INCOMING" || d === "INBOUND") return "INCOMING";
  if (d === "OUTGOING" || d === "OUTBOUND") return "OUTGOING";
  return "UNKNOWN";
}

/** Chamada entra no período pela data de início ou, se ausente, pela de registro. */
function callOccurredInRange(from: Date, to: Date) {
  return {
    OR: [
      { startedAt: { gte: from, lte: to } },
      { startedAt: null, createdAt: { gte: from, lte: to } },
    ],
  };
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

  const [wavoipEnabled, nvoipEnabled, threeCxEnabled, sipEnabled] = await Promise.all([
    isOrganizationFeatureEnabled(organizationId, "wavoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "nvoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "threecx_voice"),
    isOrganizationFeatureEnabled(organizationId, "nvoip_embedded_sip"),
  ]);

  const dateWhere = callOccurredInRange(from, to);
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

  const [wavoipLogs, nvoipLogs, threeCxLogs, sipLogs, agentUsers] = await Promise.all([
    wavoipEnabled
      ? prisma.wavoipCallLog.findMany({
          where: {
            organizationId,
            ...dateWhere,
          },
          select: callSelect,
        })
      : Promise.resolve([]),
    nvoipEnabled
      ? prisma.nvoipCallLog.findMany({
          where: { organizationId, ...dateWhere },
          select: callSelect,
        })
      : Promise.resolve([]),
    threeCxEnabled
      ? prisma.threeCxCallLog.findMany({
          where: { organizationId, ...dateWhere },
          select: callSelect,
        })
      : Promise.resolve([]),
    sipEnabled
      ? prisma.sipCallLog.findMany({
          where: { organizationId, ...dateWhere },
          select: {
            direction: true,
            status: true,
            durationSec: true,
            endedAt: true,
            initiatedByUserId: true,
            startedAt: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
      },
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
    ...sipLogs.map((r) => ({
      provider: "sip" as const,
      direction: r.direction,
      status: r.status,
      durationSec: r.durationSec,
      endedAt: r.endedAt,
      recordUrl: null,
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
    const dir = normalizeCallDirection(call.direction);
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

  const enabled = wavoipEnabled || nvoipEnabled || threeCxEnabled || sipEnabled;

  return {
    enabled,
    providers: {
      wavoip: { enabled: wavoipEnabled, hasData: wavoipLogs.length > 0 },
      nvoip: { enabled: nvoipEnabled, hasData: nvoipLogs.length > 0 },
      threecx: { enabled: threeCxEnabled, hasData: threeCxLogs.length > 0 },
      sip: { enabled: sipEnabled, hasData: sipLogs.length > 0 },
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
    byProvider: (["wavoip", "nvoip", "threecx", "sip"] as TelephonyProvider[])
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

const AGENT_HISTORY_LIMIT = 100;

export type TelephonyAgentDetail = {
  agent: { userId: string; name: string };
  summary: {
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    totalTalkTimeSec: number;
    avgTalkTimeSec: number | null;
  };
  calls: Array<{
    id: string;
    provider: TelephonyProvider;
    direction: "INCOMING" | "OUTGOING" | "UNKNOWN";
    status: string;
    outcome: CallOutcome;
    caller: string;
    receiver: string;
    contactName: string | null;
    durationSec: number | null;
    startedAt: string;
  }>;
};

export async function buildTelephonyAgentDetail(input: {
  organizationId: string;
  userId: string;
  from: Date;
  to: Date;
}): Promise<TelephonyAgentDetail | null> {
  const { organizationId, userId, from, to } = input;
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
    },
    select: { id: true, name: true, displayName: true },
  });
  if (!user) return null;

  const [wavoipEnabled, nvoipEnabled, threeCxEnabled, sipEnabled] = await Promise.all([
    isOrganizationFeatureEnabled(organizationId, "wavoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "nvoip_voice"),
    isOrganizationFeatureEnabled(organizationId, "threecx_voice"),
    isOrganizationFeatureEnabled(organizationId, "nvoip_embedded_sip"),
  ]);

  const where = {
    organizationId,
    initiatedByUserId: userId,
    ...callOccurredInRange(from, to),
  };
  const select = {
    id: true,
    direction: true,
    status: true,
    durationSec: true,
    endedAt: true,
    startedAt: true,
    createdAt: true,
    caller: true,
    receiver: true,
    contact: { select: { name: true } },
  } as const;

  const [wavoipLogs, nvoipLogs, threeCxLogs, sipLogs] = await Promise.all([
    wavoipEnabled ? prisma.wavoipCallLog.findMany({ where, select }) : Promise.resolve([]),
    nvoipEnabled ? prisma.nvoipCallLog.findMany({ where, select }) : Promise.resolve([]),
    threeCxEnabled ? prisma.threeCxCallLog.findMany({ where, select }) : Promise.resolve([]),
    sipEnabled ? prisma.sipCallLog.findMany({ where, select }) : Promise.resolve([]),
  ]);

  const rows = [
    ...wavoipLogs.map((row) => ({ ...row, provider: "wavoip" as const })),
    ...nvoipLogs.map((row) => ({ ...row, provider: "nvoip" as const })),
    ...threeCxLogs.map((row) => ({ ...row, provider: "threecx" as const })),
    ...sipLogs.map((row) => ({ ...row, provider: "sip" as const })),
  ]
    .map((row) => {
      const call: NormalizedCall = {
        provider: row.provider,
        direction: row.direction,
        status: row.status,
        durationSec: row.durationSec,
        endedAt: row.endedAt,
        recordUrl: null,
        initiatedByUserId: userId,
        callAt: row.startedAt ?? row.createdAt,
      };
      return {
        id: row.id,
        provider: row.provider,
        direction: normalizeCallDirection(row.direction),
        status: row.status,
        outcome: classifyCallOutcome(call),
        caller: row.caller,
        receiver: row.receiver,
        contactName: row.contact?.name?.trim() || null,
        durationSec: row.durationSec,
        callAt: call.callAt,
      };
    })
    .sort((a, b) => b.callAt.getTime() - a.callAt.getTime());

  let inboundCalls = 0;
  let outboundCalls = 0;
  let answeredCalls = 0;
  let missedCalls = 0;
  let totalTalkTimeSec = 0;
  let talkN = 0;
  for (const row of rows) {
    if (row.direction === "INCOMING") inboundCalls += 1;
    if (row.direction === "OUTGOING") outboundCalls += 1;
    if (row.outcome === "answered") answeredCalls += 1;
    if (row.outcome === "missed") missedCalls += 1;
    if (row.durationSec != null && row.durationSec > 0) {
      totalTalkTimeSec += row.durationSec;
      talkN += 1;
    }
  }

  return {
    agent: { userId: user.id, name: user.displayName?.trim() || user.name },
    summary: {
      totalCalls: rows.length,
      inboundCalls,
      outboundCalls,
      answeredCalls,
      missedCalls,
      totalTalkTimeSec,
      avgTalkTimeSec: talkN > 0 ? round2(totalTalkTimeSec / talkN) : null,
    },
    calls: rows.slice(0, AGENT_HISTORY_LIMIT).map((row) => ({
      id: row.id,
      provider: row.provider,
      direction: row.direction,
      status: row.status,
      outcome: row.outcome,
      caller: row.caller,
      receiver: row.receiver,
      contactName: row.contactName,
      durationSec: row.durationSec,
      startedAt: row.callAt.toISOString(),
    })),
  };
}
