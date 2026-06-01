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
  let body = `[Wavoip] Chamada ${dirLabel} — ${peer} — ${status}${dur}`;
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

export function wavoipCallProviderMsgId(input: {
  whatsappCallId: number;
  clientCallId?: string | null;
}): string {
  const client = input.clientCallId?.trim();
  if (client) return `wavoip:call:${client}`;
  return `wavoip:call:wid:${input.whatsappCallId}`;
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
}): Promise<string | null> {
  const status = input.status.toUpperCase();
  if (!shouldCreateTimelineMessage(status, input.direction)) return null;

  const providerMsgId = wavoipCallProviderMsgId({
    whatsappCallId: input.whatsappCallId,
    clientCallId: input.clientCallId,
  });
  const body = formatWavoipCallMessageBody(input);
  const type = input.mediaUrl || input.recordUrl ? "AUDIO" : "TEXT";

  const existing = await prisma.message.findFirst({
    where: { conversationId: input.conversationId, providerMsgId },
    select: { id: true },
  });
  if (existing) {
    await prisma.message.update({
      where: { id: existing.id },
      data: {
        body,
        type,
        mediaUrl: input.mediaUrl ?? input.recordUrl ?? null,
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
      providerMsgId,
      status: "DELIVERED",
    },
  });
  return msg.id;
}
