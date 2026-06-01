import type { MessageDirection } from "@prisma/client";
import { prisma } from "../db.js";

const TERMINAL_STATUSES = new Set([
  "ENDED",
  "ANSWERED",
  "NOT_ANSWERED",
  "MISSED",
  "REJECTED",
  "FAILED",
  "BUSY",
  "CANCELLED",
]);

export function formatThreeCxCallMessageBody(input: {
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
  let body = `[3CX] Chamada ${dirLabel} — ${peer} — ${status}${dur}`;
  if (input.recordUrl?.trim()) {
    body += `\nGravação: ${input.recordUrl.trim()}`;
  }
  return body;
}

export function threeCxCallMessageDirection(direction: string): MessageDirection {
  return direction === "OUTGOING" ? "OUTBOUND" : "INBOUND";
}

export function shouldCreateThreeCxTimelineMessage(status: string, direction?: string): boolean {
  const s = status.toUpperCase();
  if (direction === "INCOMING" && (s === "RINGING" || s === "DIALING")) return true;
  if (direction === "OUTGOING" && (s === "DIALING" || s === "RINGING" || s === "ACTIVE")) return true;
  return TERMINAL_STATUSES.has(s);
}

export function normalizeThreeCxTerminalStatus(status: string): string {
  const s = status.toUpperCase();
  if (TERMINAL_STATUSES.has(s)) return s;
  return "ENDED";
}

export function threeCxCallProviderMsgId(input: {
  externalCallId: string;
  clientCallId?: string | null;
}): string {
  const client = input.clientCallId?.trim();
  if (client) return `threecx:call:${client}`;
  return `threecx:call:ext:${input.externalCallId}`;
}

export async function upsertThreeCxTimelineMessage(input: {
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
  if (!shouldCreateThreeCxTimelineMessage(status, input.direction)) return null;

  const providerMsgId = threeCxCallProviderMsgId({
    externalCallId: input.externalCallId,
    clientCallId: input.clientCallId,
  });
  const body = formatThreeCxCallMessageBody(input);
  const direction = threeCxCallMessageDirection(input.direction);

  const existing = await prisma.message.findFirst({
    where: { conversationId: input.conversationId, providerMsgId },
    select: { id: true },
  });

  if (existing) {
    await prisma.message.update({
      where: { id: existing.id },
      data: { body, status: "DELIVERED" },
    });
    return existing.id;
  }

  const msg = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction,
      type: "TEXT",
      body,
      status: "DELIVERED",
      providerMsgId,
    },
    select: { id: true },
  });
  return msg.id;
}
