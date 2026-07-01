import { subMinutes } from "date-fns";
import { prisma } from "../db.js";
import {
  isNvoipCallLogActive,
  normalizeNvoipTerminalStatus,
} from "./nvoipCallTimeline.js";
import { isWavoipCallLogActive } from "./wavoipCallTimeline.js";

export type ActiveVoiceCallInfo = {
  provider: "wavoip" | "nvoip";
  conversationId: string;
  status: string;
  agent: { id: string; name: string } | null;
};

function pickAgent(initiatedBy: { id: string; name: string } | null): { id: string; name: string } | null {
  if (initiatedBy?.id) return initiatedBy;
  return null;
}

const OUTBOUND_RINGING = new Set(["DIALING", "CALLING_ORIGIN", "CALLING_DESTINATION", "RINGING"]);
const INBOUND_ACTIVE = new Set(["RINGING", "ACTIVE", "DIALING"]);

/** Chamadas Nvoip sem ended_at que ficaram presas após falha de sync ou fecho do browser. */
export function isStaleNvoipActiveCall(log: {
  status: string;
  direction: string;
  startedAt: Date | null;
  updatedAt: Date;
}): boolean {
  const s = log.status.toUpperCase();
  const started = log.startedAt ?? log.updatedAt;
  const ageMs = Date.now() - started.getTime();
  const idleMs = Date.now() - log.updatedAt.getTime();

  if (log.direction === "OUTGOING") {
    if (OUTBOUND_RINGING.has(s)) {
      return ageMs > 12 * 60_000 || idleMs > 8 * 60_000;
    }
    if (s === "ACTIVE") {
      return ageMs > 4 * 60 * 60_000 || idleMs > 45 * 60_000;
    }
  }

  if (log.direction === "INCOMING" && INBOUND_ACTIVE.has(s)) {
    return ageMs > 30 * 60_000 || idleMs > 15 * 60_000;
  }

  return ageMs > 2 * 60 * 60_000;
}

async function closeStaleNvoipCallLog(logId: string, status: string): Promise<void> {
  try {
    await prisma.nvoipCallLog.updateMany({
      where: { id: logId, endedAt: null },
      data: {
        endedAt: new Date(),
        status: normalizeNvoipTerminalStatus(status),
      },
    });
  } catch {
    /* best-effort */
  }
}

/** Active Wavoip/Nvoip calls keyed by conversation (most recent per conversation). */
export async function loadActiveVoiceCallsByConversation(
  organizationId: string,
  conversationIds?: string[],
): Promise<Map<string, ActiveVoiceCallInfo>> {
  const recent = subMinutes(new Date(), 120);
  const conversationFilter =
    conversationIds && conversationIds.length > 0
      ? { conversationId: { in: conversationIds } }
      : { conversationId: { not: null } };

  const [wavoipLogs, nvoipLogs] = await Promise.all([
    prisma.wavoipCallLog.findMany({
      where: {
        organizationId,
        endedAt: null,
        updatedAt: { gte: recent },
        ...conversationFilter,
      },
      orderBy: { updatedAt: "desc" },
      take: conversationIds?.length ? Math.min(conversationIds.length * 2, 200) : 200,
      include: {
        initiatedByUser: { select: { id: true, name: true } },
        conversation: { select: { assignedTo: { select: { id: true, name: true } } } },
      },
    }),
    prisma.nvoipCallLog.findMany({
      where: {
        organizationId,
        endedAt: null,
        updatedAt: { gte: recent },
        ...conversationFilter,
      },
      orderBy: { updatedAt: "desc" },
      take: conversationIds?.length ? Math.min(conversationIds.length * 2, 200) : 200,
      include: {
        initiatedByUser: { select: { id: true, name: true } },
        conversation: { select: { assignedTo: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const map = new Map<string, ActiveVoiceCallInfo>();

  for (const log of wavoipLogs) {
    if (!log.conversationId || !isWavoipCallLogActive(log)) continue;
    if (map.has(log.conversationId)) continue;
    map.set(log.conversationId, {
      provider: "wavoip",
      conversationId: log.conversationId,
      status: log.status,
      agent: pickAgent(log.initiatedByUser),
    });
  }

  for (const log of nvoipLogs) {
    if (!log.conversationId || !isNvoipCallLogActive(log)) continue;
    if (isStaleNvoipActiveCall(log)) {
      void closeStaleNvoipCallLog(log.id, log.status);
      continue;
    }
    if (map.has(log.conversationId)) continue;
    map.set(log.conversationId, {
      provider: "nvoip",
      conversationId: log.conversationId,
      status: log.status,
      agent: pickAgent(log.initiatedByUser),
    });
  }

  return map;
}
