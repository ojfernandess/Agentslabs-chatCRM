import type { MessageDirection } from "@prisma/client";
import { prisma } from "../db.js";

const TERMINAL_STATUSES = new Set([
  "ENDED",
  "NOT_ANSWERED",
  "BUSY",
  "FAILED",
  "MISSED",
  "ANSWERED",
]);

export function formatNvoipCallMessageBody(input: {
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  durationSec?: number | null;
  recordUrl?: string | null;
}): string {
  const peer = input.direction === "INCOMING" ? input.caller : input.receiver;
  const dirLabel = input.direction === "INCOMING" ? "recebida" : "realizada";
  const status = input.status.toUpperCase();
  const dur =
    input.durationSec != null && input.durationSec > 0
      ? ` (${Math.floor(input.durationSec / 60)}m ${input.durationSec % 60}s)`
      : "";
  let body = `[Nvoip] Chamada ${dirLabel} — ${peer} — ${status}${dur}`;
  if (input.recordUrl?.trim()) {
    body += `\nGravação: ${input.recordUrl.trim()}`;
  }
  return body;
}

export function nvoipCallMessageDirection(direction: string): MessageDirection {
  return direction === "OUTGOING" ? "OUTBOUND" : "INBOUND";
}

const INCOMING_ACTIVE_STATUSES = new Set(["RINGING", "ACTIVE", "DIALING"]);

export function shouldCreateNvoipTimelineMessage(status: string, direction?: string): boolean {
  const s = status.toUpperCase();
  if (direction === "INCOMING" && INCOMING_ACTIVE_STATUSES.has(s)) return true;
  if (direction === "OUTGOING" && (s === "DIALING" || s === "ACTIVE")) return true;
  if (TERMINAL_STATUSES.has(s)) return true;
  return false;
}

export function normalizeNvoipTerminalStatus(status: string): string {
  const s = status.toUpperCase();
  if (TERMINAL_STATUSES.has(s)) return s;
  return "ENDED";
}

export function isNvoipCallStatusActive(status: string, direction: string): boolean {
  const s = status.toUpperCase();
  if (TERMINAL_STATUSES.has(s)) return false;
  if (direction === "INCOMING" && INCOMING_ACTIVE_STATUSES.has(s)) return true;
  if (
    direction === "OUTGOING" &&
    (s === "DIALING" ||
      s === "ACTIVE" ||
      s === "CALLING_ORIGIN" ||
      s === "CALLING_DESTINATION" ||
      s === "RINGING")
  ) {
    return true;
  }
  return false;
}

export function isNvoipCallLogActive(log: {
  status: string;
  direction: string;
  endedAt: Date | null;
}): boolean {
  if (log.endedAt) return false;
  return isNvoipCallStatusActive(log.status, log.direction);
}

export function nvoipCallProviderMsgId(input: {
  externalCallId: string;
  clientCallId?: string | null;
}): string {
  const client = input.clientCallId?.trim();
  if (client) return `nvoip:call:${client}`;
  return `nvoip:call:ext:${input.externalCallId}`;
}

export async function upsertNvoipTimelineMessage(input: {
  conversationId: string;
  externalCallId: string;
  clientCallId?: string | null;
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  durationSec?: number | null;
  recordUrl?: string | null;
}): Promise<string | null> {
  const status = input.status.toUpperCase();
  if (!shouldCreateNvoipTimelineMessage(status, input.direction)) return null;

  const providerMsgId = nvoipCallProviderMsgId({
    externalCallId: input.externalCallId,
    clientCallId: input.clientCallId,
  });
  const body = formatNvoipCallMessageBody(input);
  const direction = nvoipCallMessageDirection(input.direction);
  const type = input.recordUrl?.trim() ? "AUDIO" : "TEXT";
  const mediaUrl = input.recordUrl?.trim() ?? null;

  const existing = await prisma.message.findFirst({
    where: { conversationId: input.conversationId, providerMsgId },
    select: { id: true },
  });

  if (existing) {
    await prisma.message.update({
      where: { id: existing.id },
      data: { body, type, mediaUrl, status: "DELIVERED" },
    });
    return existing.id;
  }

  const msg = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction,
      type,
      body,
      mediaUrl,
      status: "DELIVERED",
      providerMsgId,
    },
    select: { id: true },
  });
  return msg.id;
}
