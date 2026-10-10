import { prisma } from "../db.js";
import { getActivePresenceUserIds } from "./presenceService.js";
import { getOrgSipServer } from "./orgSipServer.js";
import {
  DISTRIBUTION_CALL_WINDOW_MS,
  DISTRIBUTION_TIME_ZONE,
  SIP_REGISTER_FRESH_MS,
  leastCallsPriorityPool,
  resolveDistributionAgentStatus,
  saoPauloDayStart,
  summarizeDistributionDay,
  type DistributionBoardStatus,
} from "./sipCallDistribution.js";

export type SipDistributionBoardAgent = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  extension: string;
  status: DistributionBoardStatus;
  crmPresent: boolean;
  sipState: "registered" | "busy" | "offline" | null;
  sipUpdatedAt: string | null;
  offered: number;
  answered: number;
  priority: boolean;
};

export type SipDistributionBoard = {
  enabled: boolean;
  timeZone: string;
  periodStart: string;
  generatedAt: string;
  sipFreshMs: number;
  totals: { online: number; received: number; answered: number };
  agents: SipDistributionBoardAgent[];
  next: {
    kind: "none" | "one" | "tie";
    offered: number;
    agents: Array<{ userId: string; name: string; extension: string }>;
  };
};

const EMPTY_NEXT: SipDistributionBoard["next"] = { kind: "none", offered: 0, agents: [] };

function answeredRow(status: string, answeredAt: Date | null): boolean {
  return answeredAt != null || status === "ANSWERED" || status === "ENDED";
}

/** Retrato do dia para o painel. Não reserva atendente e não executa o sorteio. */
export async function buildSipDistributionBoard(organizationId: string, now = new Date()): Promise<SipDistributionBoard> {
  const server = await getOrgSipServer(organizationId);
  const enabled = server?.callDistribution === true;
  const dayStart = saoPauloDayStart(now);
  const freshAfter = new Date(now.getTime() - SIP_REGISTER_FRESH_MS);
  const offerAfter = new Date(now.getTime() - DISTRIBUTION_CALL_WINDOW_MS);

  const credentials = await prisma.userSipCredentials.findMany({
    where: {
      user: {
        OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
      },
    },
    select: {
      sipUser: true,
      user: {
        select: {
          id: true,
          name: true,
          displayName: true,
          avatarUrl: true,
          availabilityStatus: true,
        },
      },
    },
  });

  const userIds = credentials.map((row) => row.user.id);
  if (userIds.length === 0) {
    return {
      enabled,
      timeZone: DISTRIBUTION_TIME_ZONE,
      periodStart: dayStart.toISOString(),
      generatedAt: now.toISOString(),
      sipFreshMs: SIP_REGISTER_FRESH_MS,
      totals: { online: 0, received: 0, answered: 0 },
      agents: [],
      next: EMPTY_NEXT,
    };
  }

  const [present, sipRows, openRows, todayRows] = await Promise.all([
    getActivePresenceUserIds(organizationId, userIds),
    prisma.sipAgentPresence.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { userId: true, state: true, updatedAt: true },
    }),
    prisma.sipCallDistribution.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
        endedAt: null,
        OR: [
          { status: "ANSWERED" },
          { status: "OFFERED", offeredAt: { gte: offerAfter } },
        ],
      },
      select: { userId: true, status: true, offeredAt: true },
    }),
    prisma.sipCallDistribution.findMany({
      where: { organizationId, offeredAt: { gte: dayStart } },
      select: {
        userId: true,
        callerDigits: true,
        sipCallId: true,
        offeredAt: true,
        answeredAt: true,
        status: true,
      },
    }),
  ]);

  const summary = summarizeDistributionDay(
    todayRows.map((row) => ({
      userId: row.userId,
      callerDigits: row.callerDigits,
      sipCallId: row.sipCallId,
      offeredAtMs: row.offeredAt.getTime(),
      answered: answeredRow(row.status, row.answeredAt),
    })),
  );
  const sipByUser = new Map(sipRows.map((row) => [row.userId, row]));
  const openByUser = new Map<string, "OFFERED" | "ANSWERED">();
  for (const row of openRows) {
    if (row.status === "ANSWERED") openByUser.set(row.userId, "ANSWERED");
    else if (!openByUser.has(row.userId)) openByUser.set(row.userId, "OFFERED");
  }

  const agents: SipDistributionBoardAgent[] = credentials.map((row) => {
    const sip = sipByUser.get(row.user.id);
    const sipFresh = !!sip && sip.updatedAt >= freshAfter;
    const sipState = sip?.state === "registered" || sip?.state === "busy" || sip?.state === "offline" ? sip.state : null;
    const counts = summary.byUser.get(row.user.id);
    const availability = row.user.availabilityStatus;
    return {
      userId: row.user.id,
      name: row.user.displayName?.trim() || row.user.name,
      avatarUrl: row.user.avatarUrl,
      extension: row.sipUser,
      status: resolveDistributionAgentStatus({
        availability,
        crmPresent: present.has(row.user.id),
        sipRegistered: sipFresh && sipState === "registered",
        sipBusy: sipFresh && sipState === "busy",
        openOffer: openByUser.get(row.user.id) ?? null,
      }),
      crmPresent: present.has(row.user.id),
      sipState,
      sipUpdatedAt: sip?.updatedAt.toISOString() ?? null,
      offered: counts?.offered ?? 0,
      answered: counts?.answered ?? 0,
      priority: false,
    };
  });

  const pool = leastCallsPriorityPool(
    agents
      .filter((agent) => agent.status === "available")
      .map((agent) => ({ userId: agent.userId, offeredToday: agent.offered })),
  );
  const priorityIds = new Set(pool.map((agent) => agent.userId));
  for (const agent of agents) agent.priority = priorityIds.has(agent.userId);
  agents.sort((a, b) => a.name.localeCompare(b.name, "pt"));

  const nextAgents = pool
    .map((candidate) => agents.find((agent) => agent.userId === candidate.userId))
    .filter((agent): agent is SipDistributionBoardAgent => !!agent)
    .map((agent) => ({ userId: agent.userId, name: agent.name, extension: agent.extension }));

  return {
    enabled,
    timeZone: DISTRIBUTION_TIME_ZONE,
    periodStart: dayStart.toISOString(),
    generatedAt: now.toISOString(),
    sipFreshMs: SIP_REGISTER_FRESH_MS,
    totals: {
      online: agents.filter((agent) => agent.crmPresent).length,
      received: summary.received,
      answered: summary.answered,
    },
    agents,
    next:
      nextAgents.length === 0
        ? EMPTY_NEXT
        : {
            kind: nextAgents.length === 1 ? "one" : "tie",
            offered: pool[0]?.offeredToday ?? 0,
            agents: nextAgents,
          },
  };
}
