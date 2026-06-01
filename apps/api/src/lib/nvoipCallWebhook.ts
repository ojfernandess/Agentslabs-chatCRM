import type { NvoipAccount } from "@prisma/client";
import { prisma } from "../db.js";
import { syncNvoipCallFromApi } from "./nvoipAgentCall.js";
import type { NvoipHistoryCallItem } from "./nvoipClient.js";
import { ingestNvoipInboundHistoryItem } from "./nvoipInboundSync.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

export async function handleNvoipCallWebhook(input: {
  organizationId: string;
  body: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId: input.organizationId, status: "CONNECTED" },
  });
  if (!account) {
    return { ok: false, status: 404, message: "nvoip_account_not_found" };
  }

  const callId = pickString(input.body, ["callId", "call_id", "id"]);
  if (!callId) {
    return { ok: false, status: 400, message: "missing_call_id" };
  }

  const state = pickString(input.body, ["state", "status", "callState"]);
  const caller = pickString(input.body, ["caller", "from", "origin"]);
  const called = pickString(input.body, ["called", "to", "destination", "receiver"]);
  const directionRaw = pickString(input.body, ["direction", "type"]).toLowerCase();
  const isInbound =
    directionRaw.includes("in") ||
    directionRaw === "inbound" ||
    (!directionRaw && caller && !called);

  const existing = await prisma.nvoipCallLog.findFirst({
    where: { organizationId: input.organizationId, externalCallId: callId },
  });

  try {
    if (existing) {
      await syncNvoipCallFromApi({
        organizationId: input.organizationId,
        externalCallId: callId,
        clientCallId: existing.clientCallId,
      });
    } else if (isInbound && state) {
      const item: NvoipHistoryCallItem = {
        callId,
        caller: caller || called,
        called: called || account.defaultCaller,
        state,
        linkAudio: pickString(input.body, ["linkAudio", "link_audio", "recording"]) || null,
        talkingDurationSeconds: null,
        totalDurationSeconds: null,
        raw: input.body,
      };
      await ingestNvoipInboundHistoryItem(account, item);
    } else {
      await syncNvoipCallFromApi({
        organizationId: input.organizationId,
        externalCallId: callId,
      });
    }
  } catch (err) {
    await writeNvoipIntegrationLog({
      organizationId: input.organizationId,
      nvoipAccountId: account.id,
      level: "warn",
      eventType: "webhook_call_failed",
      message: err instanceof Error ? err.message : "webhook_failed",
      payload: input.body,
    });
    return { ok: false, status: 400, message: err instanceof Error ? err.message : "webhook_failed" };
  }

  await writeNvoipIntegrationLog({
    organizationId: input.organizationId,
    nvoipAccountId: account.id,
    level: "info",
    eventType: "webhook_call",
    message: `Webhook call ${callId} (${state || "sync"})`,
    payload: { callId, state, direction: isInbound ? "inbound" : "outbound" },
  });

  return { ok: true };
}
