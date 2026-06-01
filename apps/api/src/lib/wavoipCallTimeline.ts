import type { MessageDirection } from "@prisma/client";
import { prisma } from "../db.js";

const TERMINAL_STATUSES = new Set([
  "ENDED",
  "REJECTED",
  "NOT_ANSWERED",
  "FAILED",
  "HANDLED_REMOTELY",
  "DISCONNECTED",
]);

const OUTBOUND_ACTIVE_STATUSES = new Set(["CALLING", "RINGING", "ACTIVE"]);

export function formatWavoipCallMessageBody(input: {
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  durationSec?: number | null;
  recordUrl?: string | null;
}): string {
  const peer = input.direction === "INCOMING" ? input.caller : input.receiver;
  const dirLabel = input.direction === "INCOMING" ? "recebida" : "realizada";
  const status = input.status.toUpperCase() === "DISCONNECTED" ? "ENDED" : input.status.toUpperCase();
  const dur =
    input.durationSec != null && input.durationSec > 0
      ? ` (${Math.floor(input.durationSec / 60)}m ${input.durationSec % 60}s)`
      : "";
  const statusLabel =
    input.direction === "INCOMING" && (status === "RINGING" || status === "NONE" || status === "CALLING")
      ? "a tocar"
      : status;
  let body = `[Wavoip] Chamada ${dirLabel} — ${peer} — ${statusLabel}${dur}`;
  if (input.recordUrl?.trim()) {
    body += `\nGravação: ${input.recordUrl.trim()}`;
  }
  return body;
}

export function callMessageDirection(direction: string): MessageDirection {
  return direction === "OUTGOING" ? "OUTBOUND" : "INBOUND";
}

const INCOMING_ACTIVE_STATUSES = new Set(["RINGING", "NONE", "ACTIVE", "CALLING", "CONNECTING"]);

/** Only one timeline message per call — active/terminal status updates the same row. */
export function shouldCreateTimelineMessage(status: string, direction?: string): boolean {
  const s = status.toUpperCase();
  if (direction === "INCOMING" && INCOMING_ACTIVE_STATUSES.has(s)) return true;
  if (direction === "OUTGOING" && OUTBOUND_ACTIVE_STATUSES.has(s)) return true;
  return TERMINAL_STATUSES.has(s);
}

export function normalizeTerminalCallStatus(status: string): string {
  const s = status.toUpperCase();
  if (TERMINAL_STATUSES.has(s)) return s === "DISCONNECTED" ? "ENDED" : s;
  if (s === "ACTIVE" || s === "CALLING" || s === "RINGING" || s === "NONE") return "ENDED";
  return "ENDED";
}

export function isWavoipCallStatusActive(status: string, direction: string): boolean {
  const s = status.toUpperCase();
  if (TERMINAL_STATUSES.has(s) || s === "DISCONNECTED") return false;
  if (direction === "INCOMING" && INCOMING_ACTIVE_STATUSES.has(s)) return true;
  if (direction === "OUTGOING" && OUTBOUND_ACTIVE_STATUSES.has(s)) return true;
  return false;
}

export function isWavoipCallLogActive(log: {
  status: string;
  direction: string;
  endedAt: Date | null;
}): boolean {
  if (log.endedAt) return false;
  return isWavoipCallStatusActive(log.status, log.direction);
}

export function wavoipCallProviderMsgId(input: {
  whatsappCallId: number;
  clientCallId?: string | null;
}): string {
  const client = input.clientCallId?.trim();
  if (client) return `wavoip:call:${client}`;
  return `wavoip:call:wid:${input.whatsappCallId}`;
}

/** IDs alternativos (SDK offer vs webhook) para a mesma chamada. */
export function wavoipCallProviderMsgIds(input: {
  whatsappCallId: number;
  clientCallId?: string | null;
}): string[] {
  const ids = new Set<string>();
  const client = input.clientCallId?.trim();
  if (client) ids.add(`wavoip:call:${client}`);
  if (Number.isFinite(input.whatsappCallId)) {
    ids.add(`wavoip:call:wid:${input.whatsappCallId}`);
  }
  return [...ids];
}

async function findExistingWavoipCallMessage(input: {
  conversationId: string;
  providerMsgIds: string[];
  existingMessageId?: string | null;
  peerPhone?: string;
  direction: string;
  status: string;
}): Promise<{ id: string; providerMsgId: string | null } | null> {
  if (input.existingMessageId) {
    const row = await prisma.message.findFirst({
      where: { id: input.existingMessageId, conversationId: input.conversationId },
      select: { id: true, providerMsgId: true },
    });
    if (row) return row;
  }

  if (input.providerMsgIds.length > 0) {
    const row = await prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        providerMsgId: { in: input.providerMsgIds },
      },
      select: { id: true, providerMsgId: true },
    });
    if (row) return row;
  }

  const s = input.status.toUpperCase();
  const isIncomingRing =
    input.direction === "INCOMING" &&
    INCOMING_ACTIVE_STATUSES.has(s) &&
    !TERMINAL_STATUSES.has(s);
  if (!isIncomingRing || !input.peerPhone?.trim()) return null;

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const peer = input.peerPhone.trim();
  const candidates = await prisma.message.findMany({
    where: {
      conversationId: input.conversationId,
      direction: "INBOUND",
      createdAt: { gte: since },
      body: { startsWith: "[Wavoip] Chamada recebida" },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, providerMsgId: true, body: true },
  });
  const match = candidates.find((m) => (m.body ?? "").includes(peer));
  return match ? { id: match.id, providerMsgId: match.providerMsgId } : null;
}

export async function upsertWavoipTimelineMessage(input: {
  conversationId: string;
  whatsappCallId: number;
  clientCallId?: string | null;
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  durationSec?: number | null;
  recordUrl?: string | null;
  mediaUrl?: string | null;
  /** Mensagem criada pelo screen-pop (SDK) antes do webhook. */
  existingMessageId?: string | null;
}): Promise<string | null> {
  const status = input.status.toUpperCase();
  if (!shouldCreateTimelineMessage(status, input.direction)) return null;

  const providerMsgIds = wavoipCallProviderMsgIds({
    whatsappCallId: input.whatsappCallId,
    clientCallId: input.clientCallId,
  });
  const canonicalProviderMsgId = wavoipCallProviderMsgId({
    whatsappCallId: input.whatsappCallId,
    clientCallId: input.clientCallId,
  });
  const body = formatWavoipCallMessageBody(input);
  const type = input.mediaUrl || input.recordUrl ? "AUDIO" : "TEXT";
  const peerPhone = input.direction === "INCOMING" ? input.caller : input.receiver;

  const existing = await findExistingWavoipCallMessage({
    conversationId: input.conversationId,
    providerMsgIds,
    existingMessageId: input.existingMessageId,
    peerPhone,
    direction: input.direction,
    status,
  });
  if (existing) {
    await prisma.message.update({
      where: { id: existing.id },
      data: {
        body,
        type,
        mediaUrl: input.mediaUrl ?? input.recordUrl ?? null,
        providerMsgId: canonicalProviderMsgId,
      },
    });
    return existing.id;
  }

  const msg = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: callMessageDirection(input.direction),
      type,
      body,
      mediaUrl: input.mediaUrl ?? input.recordUrl ?? null,
      providerMsgId: canonicalProviderMsgId,
      status: "DELIVERED",
    },
  });
  return msg.id;
}
