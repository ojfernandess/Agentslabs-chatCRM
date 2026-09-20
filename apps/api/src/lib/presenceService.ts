import type { UserAvailabilityStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { presenceCutoffDate } from "./presenceConfig.js";
import {
  availabilityToClient,
  resolveEffectiveAvailability,
  type AvailabilityClient,
} from "./userAvailability.js";
import { broadcastUserPresenceChanged } from "./workspaceHub.js";

export type PresenceSource = "websocket" | "http";

const SESSION_KEY_MIN = 8;
const SESSION_KEY_MAX = 64;

export function isValidPresenceSessionKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= SESSION_KEY_MIN && trimmed.length <= SESSION_KEY_MAX;
}

export async function touchPresenceSession(params: {
  userId: string;
  organizationId: string;
  sessionKey: string;
  source: PresenceSource;
  /** Só na conexão inicial (login / WS open) — heartbeats não reactivam sessão encerrada. */
  allowReconnect?: boolean;
}): Promise<boolean> {
  const sessionKey = params.sessionKey.trim();
  if (!isValidPresenceSessionKey(sessionKey)) return false;

  const existing = await prisma.userPresenceSession.findUnique({
    where: { userId_sessionKey: { userId: params.userId, sessionKey } },
    select: { disconnectedAt: true },
  });
  if (existing?.disconnectedAt && !params.allowReconnect) {
    return false;
  }

  const now = new Date();
  await prisma.userPresenceSession.upsert({
    where: {
      userId_sessionKey: {
        userId: params.userId,
        sessionKey,
      },
    },
    create: {
      userId: params.userId,
      organizationId: params.organizationId,
      sessionKey,
      lastSeenAt: now,
      source: params.source,
    },
    update: {
      organizationId: params.organizationId,
      lastSeenAt: now,
      disconnectedAt: null,
      source: params.source,
    },
  });
  return true;
}

/** Encerra uma sessão de presença. Retorna true se o agente deixou de ter presença activa. */
export async function endPresenceSession(
  userId: string,
  sessionKey: string,
): Promise<{ becameOffline: boolean; organizationId: string | null }> {
  const key = sessionKey.trim();
  if (!isValidPresenceSessionKey(key)) {
    return { becameOffline: false, organizationId: null };
  }

  const session = await prisma.userPresenceSession.findUnique({
    where: { userId_sessionKey: { userId, sessionKey: key } },
    select: { id: true, organizationId: true, disconnectedAt: true },
  });
  if (!session || session.disconnectedAt) {
    return { becameOffline: false, organizationId: session?.organizationId ?? null };
  }

  await prisma.userPresenceSession.update({
    where: { id: session.id },
    data: { disconnectedAt: new Date() },
  });

  const stillPresent = await hasActivePresence(userId, session.organizationId);
  return { becameOffline: !stillPresent, organizationId: session.organizationId };
}

export async function hasActivePresence(userId: string, organizationId: string): Promise<boolean> {
  const cutoff = presenceCutoffDate();
  const count = await prisma.userPresenceSession.count({
    where: {
      userId,
      organizationId,
      disconnectedAt: null,
      lastSeenAt: { gte: cutoff },
    },
  });
  return count > 0;
}

export async function getActivePresenceUserIds(
  organizationId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const cutoff = presenceCutoffDate();
  const rows = await prisma.userPresenceSession.findMany({
    where: {
      organizationId,
      userId: { in: userIds },
      disconnectedAt: null,
      lastSeenAt: { gte: cutoff },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return new Set(rows.map((row) => row.userId));
}

export async function resolveUserPresenceConnected(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  return hasActivePresence(userId, organizationId);
}

export function computeEffectiveAvailability(
  availabilityStatus: UserAvailabilityStatus,
  presenceConnected: boolean,
): AvailabilityClient {
  return resolveEffectiveAvailability(availabilityStatus, presenceConnected);
}

export async function resolveEffectiveAvailabilityForUser(
  userId: string,
  organizationId: string,
  availabilityStatus: UserAvailabilityStatus,
): Promise<{ presenceConnected: boolean; effectiveAvailabilityStatus: AvailabilityClient }> {
  const presenceConnected = await hasActivePresence(userId, organizationId);
  return {
    presenceConnected,
    effectiveAvailabilityStatus: computeEffectiveAvailability(availabilityStatus, presenceConnected),
  };
}

export async function notifyPresenceChangedIfNeeded(
  userId: string,
  organizationId: string,
  becameOffline: boolean,
): Promise<void> {
  if (becameOffline) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { availabilityStatus: true },
    });
    if (!user) return;
    const effective = computeEffectiveAvailability(user.availabilityStatus, false);
    broadcastUserPresenceChanged(organizationId, userId, false, effective);
    return;
  }

  await notifyPresenceRestoredIfNeeded(userId, organizationId);
}

export async function notifyPresenceRestoredIfNeeded(
  userId: string,
  organizationId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { availabilityStatus: true },
  });
  if (!user) return;
  const present = await hasActivePresence(userId, organizationId);
  if (!present) return;
  const effective = computeEffectiveAvailability(user.availabilityStatus, true);
  broadcastUserPresenceChanged(organizationId, userId, true, effective);
}

/** Marca sessões stale como desconectadas e notifica agentes que ficaram offline. */
export async function sweepStalePresenceSessions(): Promise<void> {
  const cutoff = presenceCutoffDate();
  const stale = await prisma.userPresenceSession.findMany({
    where: {
      disconnectedAt: null,
      lastSeenAt: { lt: cutoff },
    },
    select: { id: true, userId: true, organizationId: true },
    take: 500,
  });
  if (stale.length === 0) return;

  const now = new Date();
  await prisma.userPresenceSession.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { disconnectedAt: now },
  });

  const seen = new Set<string>();
  for (const session of stale) {
    const key = `${session.organizationId}:${session.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const stillPresent = await hasActivePresence(session.userId, session.organizationId);
    if (stillPresent) continue;

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { availabilityStatus: true },
    });
    if (!user) continue;

    const effective = computeEffectiveAvailability(user.availabilityStatus, false);
    if (user.availabilityStatus === "ONLINE") {
      broadcastUserPresenceChanged(session.organizationId, session.userId, false, effective);
    }
  }
}

export async function isAgentEligibleForTransfer(
  userId: string,
  organizationId: string,
  availabilityStatus: UserAvailabilityStatus,
): Promise<boolean> {
  if (availabilityStatus !== "ONLINE") return false;
  return hasActivePresence(userId, organizationId);
}

export { availabilityToClient };
