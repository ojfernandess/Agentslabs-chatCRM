import type { MessageDirection } from "@prisma/client";
import { prisma } from "../db.js";

const TERMINAL_STATUSES = new Set([
  "ENDED",
  "REJECTED",
  "NOT_ANSWERED",
  "FAILED",
  "HANDLED_REMOTELY",
]);

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
  const dur =
    input.durationSec != null && input.durationSec > 0
      ? ` (${Math.floor(input.durationSec / 60)}m ${input.durationSec % 60}s)`
      : "";
  let body = `[Wavoip] Chamada ${dirLabel} — ${peer} — ${input.status}${dur}`;
  if (input.recordUrl?.trim()) {
    body += `\nGravação: ${input.recordUrl.trim()}`;
  }
  return body;
}

export function callMessageDirection(direction: string): MessageDirection {
  return direction === "OUTCOMING" ? "OUTBOUND" : "INBOUND";
}

export function shouldCreateTimelineMessage(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toUpperCase()) || status.toUpperCase() === "ACTIVE";
}

export function wavoipCallProviderMsgId(whatsappCallId: number, status: string): string {
  return `wavoip:call:${whatsappCallId}:${status.toUpperCase()}`;
}

export async function upsertWavoipTimelineMessage(input: {
  conversationId: string;
  whatsappCallId: number;
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  durationSec?: number | null;
  recordUrl?: string | null;
  mediaUrl?: string | null;
}): Promise<string | null> {
  if (!shouldCreateTimelineMessage(input.status)) return null;

  const providerMsgId = wavoipCallProviderMsgId(input.whatsappCallId, input.status);
  const existing = await prisma.message.findFirst({
    where: { conversationId: input.conversationId, providerMsgId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const body = formatWavoipCallMessageBody(input);
  const type = input.mediaUrl || input.recordUrl ? "AUDIO" : "TEXT";

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
