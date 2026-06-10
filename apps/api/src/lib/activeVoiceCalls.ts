import { subMinutes } from "date-fns";
import { prisma } from "../db.js";
import { isNvoipCallLogActive } from "./nvoipCallTimeline.js";
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

function isStaleNvoipRinging(log: {
  status: string;
  direction: string;
  startedAt: Date | null;
  updatedAt: Date;
}): boolean {
  if (log.direction !== "OUTGOING") return false;
  const s = log.status.toUpperCase();
  if (!["DIALING", "CALLING_ORIGIN", "CALLING_DESTINATION", "RINGING"].includes(s)) return false;
  const anchor = log.startedAt ?? log.updatedAt;
  return Date.now() - anchor.getTime() > 45 * 60_000;
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
    if (isStaleNvoipRinging(log)) continue;
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
