import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getActivePresenceUserIds } from "./presenceService.js";
import { getOrgSipServer } from "./orgSipServer.js";
import { broadcastToOrganization } from "./workspaceHub.js";
import {
  DISTRIBUTION_CALL_WINDOW_MS,
  SIP_REGISTER_FRESH_MS,
    distributionCallerKey,
  pickLeastCallsAgent,
  saoPauloDayStart,
  summarizeDistributionDay,
} from "./sipCallDistribution.js";

const OPEN_OFFER_MS = DISTRIBUTION_CALL_WINDOW_MS;
const ANSWERED_FORK_MS = 45_000;

const TERMINAL = new Set(["REJECTED", "MISSED", "ENDED"]);

function publishDistributionBoard(organizationId: string, patch?: {
  reason: "presence";
  userId: string;
  sipState: string;
  sipUpdatedAt: string;
}): void {
  broadcastToOrganization(organizationId, {
    type: "sip.distribution.updated",
    reason: patch?.reason ?? "resync",
    ...(patch ?? {}),
  });
}

export async function touchSipAgentPresence(input: {
  userId: string;
  organizationId: string;
  state: "registered" | "busy" | "offline";
}): Promise<void> {
  const previous = await prisma.sipAgentPresence.findUnique({
    where: { userId: input.userId },
    select: { state: true, organizationId: true },
  });
  const row = await prisma.sipAgentPresence.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      organizationId: input.organizationId,
      state: input.state,
    },
    update: {
      organizationId: input.organizationId,
      state: input.state,
    },
    select: { state: true, updatedAt: true },
  });
  if (!previous || previous.state !== input.state || previous.organizationId !== input.organizationId) {
    if (previous && previous.organizationId !== input.organizationId) {
      publishDistributionBoard(previous.organizationId);
    }
    publishDistributionBoard(input.organizationId);
    return;
  }
  publishDistributionBoard(input.organizationId, {
    reason: "presence",
    userId: input.userId,
    sipState: row.state,
    sipUpdatedAt: row.updatedAt.toISOString(),
  });
}

export async function claimSipCallDistribution(input: {
  organizationId: string;
  userId: string;
  sipCallId: string;
  caller: string;
}): Promise<{ ring: boolean; distributionId: string | null }> {
  const server = await getOrgSipServer(input.organizationId);
  if (!server?.callDistribution) return { ring: true, distributionId: null };

  const creds = await prisma.userSipCredentials.findUnique({
    where: { userId: input.userId },
    select: { sipUser: true },
  });
  const callerDigits = distributionCallerKey(input.caller, creds?.sipUser ?? "");
  const lockKey = `${input.organizationId}:${callerDigits}`;

  const decision = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - OPEN_OFFER_MS);
    await tx.sipCallDistribution.updateMany({
      where: {
        organizationId: input.organizationId,
        status: "OFFERED",
        endedAt: null,
        offeredAt: { lt: staleBefore },
      },
      data: { status: "MISSED", endedAt: now },
    });

    const [recent, claimant] = await Promise.all([
      tx.sipCallDistribution.findFirst({
        where: {
          organizationId: input.organizationId,
          callerDigits,
          offeredAt: { gte: staleBefore },
          status: { in: ["OFFERED", "ANSWERED"] },
          endedAt: null,
        },
        orderBy: { offeredAt: "desc" },
      }),
      tx.user.findUnique({
        where: { id: input.userId },
        select: { availabilityStatus: true },
      }),
    ]);
    if (claimant?.availabilityStatus !== "ONLINE") {
      if (recent?.status === "OFFERED" && recent.userId === input.userId) {
        await tx.sipCallDistribution.update({
          where: { id: recent.id },
          data: { status: "MISSED", endedAt: now },
        });
      }
      return { ring: false, distributionId: null };
    }
    if (recent?.status === "ANSWERED") {
      const age = now.getTime() - recent.offeredAt.getTime();
      if (age <= ANSWERED_FORK_MS) return { ring: false, distributionId: null };
    } else if (recent?.status === "OFFERED") {
      return {
        ring: recent.userId === input.userId,
        distributionId: recent.userId === input.userId ? recent.id : null,
      };
    }

    const eligible = await eligibleAgentIds(tx, input.organizationId, now);
    if (eligible.length === 0) return { ring: true, distributionId: null };

    const dayStart = saoPauloDayStart(now);
    const todayRows = await tx.sipCallDistribution.findMany({
      where: {
        organizationId: input.organizationId,
        offeredAt: { gte: dayStart },
        userId: { in: eligible },
      },
      select: { userId: true, sipCallId: true },
    });
    const offered = summarizeDistributionDay(
      todayRows.map((row) => ({
        userId: row.userId,
        callerDigits: row.userId,
        sipCallId: row.sipCallId,
        offeredAtMs: 0,
        answered: false,
      })),
    ).byUser;
    const chosen = pickLeastCallsAgent(
      eligible.map((userId) => ({ userId, offeredToday: offered.get(userId)?.offered ?? 0 })),
    );
    if (!chosen) return { ring: true, distributionId: null };

    const row = await tx.sipCallDistribution.create({
      data: {
        organizationId: input.organizationId,
        userId: chosen,
        callerDigits,
        sipCallId: input.sipCallId.slice(0, 256),
        status: "OFFERED",
        reason: "least_calls",
        offeredCount: offered.get(chosen)?.offered ?? 0,
        attempt: 1,
        offeredAt: now,
      },
      select: { id: true, userId: true },
    });
    return {
      ring: row.userId === input.userId,
      distributionId: row.userId === input.userId ? row.id : null,
    };
  });
  publishDistributionBoard(input.organizationId);
  return decision;
}

export async function completeSipCallDistribution(input: {
  organizationId: string;
  userId: string;
  distributionId: string;
  status: "ANSWERED" | "REJECTED" | "MISSED" | "ENDED";
}): Promise<void> {
  const row = await prisma.sipCallDistribution.findFirst({
    where: {
      id: input.distributionId,
      organizationId: input.organizationId,
      userId: input.userId,
    },
    select: { status: true },
  });
  if (!row) return;
  const allowed =
    (row.status === "OFFERED" && ["ANSWERED", "REJECTED", "MISSED", "ENDED"].includes(input.status)) ||
    (row.status === "ANSWERED" && input.status === "ENDED");
  if (!allowed) return;
  const now = new Date();
  await prisma.sipCallDistribution.update({
    where: { id: input.distributionId },
    data: {
      status: input.status,
      answeredAt: input.status === "ANSWERED" ? now : undefined,
      endedAt: TERMINAL.has(input.status) ? now : undefined,
    },
  });
  publishDistributionBoard(input.organizationId);
}

type Tx = Prisma.TransactionClient;

async function eligibleAgentIds(tx: Tx, organizationId: string, now: Date): Promise<string[]> {
  const [credentials, busy] = await Promise.all([
    tx.userSipCredentials.findMany({
      where: {
        user: {
          availabilityStatus: "ONLINE",
          OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
        },
      },
      select: { userId: true },
    }),
    tx.sipCallDistribution.findMany({
      where: {
        organizationId,
        endedAt: null,
        OR: [
          { status: "ANSWERED" },
          { status: "OFFERED", offeredAt: { gte: new Date(now.getTime() - OPEN_OFFER_MS) } },
        ],
      },
      select: { userId: true },
    }),
  ]);
  const userIds = credentials.map((row) => row.userId);
  if (userIds.length === 0) return [];
  const [present, sipReady] = await Promise.all([
    getActivePresenceUserIds(organizationId, userIds),
    tx.sipAgentPresence.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
        state: "registered",
        updatedAt: { gte: new Date(now.getTime() - SIP_REGISTER_FRESH_MS) },
      },
      select: { userId: true },
    }),
  ]);
  const ready = new Set(sipReady.map((row) => row.userId));
  const occupied = new Set(busy.map((row) => row.userId));
  return userIds.filter((userId) => present.has(userId) && ready.has(userId) && !occupied.has(userId));
}
