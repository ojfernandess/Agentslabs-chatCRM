import type { NvoipAccount } from "@prisma/client";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
import {
  isNvoipTerminalState,
  mapNvoipStateToCrmStatus,
  type NvoipHistoryCallItem,
  nvoipGetCallHistory,
} from "./nvoipClient.js";
import { resolveNvoipCallContext } from "./nvoipCallContext.js";
import { upsertNvoipTimelineMessage } from "./nvoipCallTimeline.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { resolveNvoipIncomingTargetUserIds } from "./nvoipIncomingQueue.js";

export { resolveNvoipIncomingTargetUserIds };

export function mapNvoipHistoryStateToCrmStatus(
  state: string,
  direction: "INCOMING" | "OUTGOING",
): string {
  const s = state.toLowerCase();
  if (direction === "INCOMING" && (s === "calling_destination" || s === "calling_origin")) {
    return "RINGING";
  }
  if (direction === "OUTGOING" && (s === "calling_origin" || s === "calling_destination")) {
    return "DIALING";
  }
  if (s === "established") return "ACTIVE";
  return mapNvoipStateToCrmStatus(state);
}

async function emitNvoipIncomingScreenPop(input: {
  organizationId: string;
  nvoipAccountId: string;
  externalCallId: string;
  caller: string;
  receiver: string;
  contactId: string | null;
  conversationId: string | null;
  accountExternalConfig: unknown;
}): Promise<void> {
  const targetUserIds = await resolveNvoipIncomingTargetUserIds(
    input.organizationId,
    input.receiver,
    input.accountExternalConfig,
  );
  broadcastToOrganization(input.organizationId, {
    type: "nvoip.call.incoming",
    nvoipAccountId: input.nvoipAccountId,
    callId: input.externalCallId,
    caller: input.caller,
    receiver: input.receiver,
    contactId: input.contactId,
    conversationId: input.conversationId,
    targetUserIds,
  });
}

export async function ingestNvoipInboundHistoryItem(
  account: NvoipAccount,
  item: NvoipHistoryCallItem,
): Promise<{ created: boolean; screenPop: boolean }> {
  const peerPhone = item.caller || item.called;
  if (!peerPhone.trim()) {
    return { created: false, screenPop: false };
  }

  const ctx = await resolveNvoipCallContext({
    organizationId: account.organizationId,
    nvoipAccountId: account.id,
    phone: peerPhone,
    contactId: null,
    conversationId: null,
  });

  const caller = (item.caller || ctx.dialPhone).replace(/\D/g, "").slice(0, 32) || item.caller.slice(0, 32);
  const receiver =
    (item.called || account.defaultCaller).replace(/\D/g, "").slice(0, 32) ||
    account.defaultCaller.slice(0, 32);
  const crmStatus = mapNvoipHistoryStateToCrmStatus(item.state, "INCOMING");
  const terminal = isNvoipTerminalState(item.state);
  const durationSec = item.talkingDurationSeconds ?? item.totalDurationSeconds;
  const recordUrl = item.linkAudio?.trim() || null;

  const existing = await prisma.nvoipCallLog.findUnique({
    where: {
      nvoipAccountId_externalCallId: {
        nvoipAccountId: account.id,
        externalCallId: item.callId,
      },
    },
  });

  const isNew = !existing;
  const previousStatus = existing?.status ?? null;

  const row = await prisma.nvoipCallLog.upsert({
    where: {
      nvoipAccountId_externalCallId: {
        nvoipAccountId: account.id,
        externalCallId: item.callId,
      },
    },
    create: {
      organizationId: account.organizationId,
      nvoipAccountId: account.id,
      externalCallId: item.callId,
      direction: "INCOMING",
      caller,
      receiver,
      status: crmStatus,
      durationSec: durationSec ?? null,
      recordUrl,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      startedAt: new Date(),
      endedAt: terminal ? new Date() : null,
      rawPayload: item.raw as object,
    },
    update: {
      status: crmStatus,
      durationSec: durationSec ?? undefined,
      recordUrl: recordUrl ?? undefined,
      contactId: ctx.contactId ?? undefined,
      conversationId: ctx.conversationId ?? undefined,
      endedAt: terminal ? new Date() : undefined,
      rawPayload: item.raw as object,
    },
  });

  if (ctx.contactId) {
    await appendTimelineEvent({
      organizationId: account.organizationId,
      subjectType: "CONTACT",
      subjectId: ctx.contactId,
      eventType: "nvoip_call",
      channel: "NVOIP",
      sourceId: item.callId,
      payload: {
        title: `Chamada recebida de ${caller}`,
        direction: "INCOMING",
        status: crmStatus,
        durationSec: durationSec ?? null,
        recordUrl,
      },
    });
  }

  let messageId = row.messageId;
  if (ctx.conversationId) {
    messageId =
      (await upsertNvoipTimelineMessage({
        conversationId: ctx.conversationId,
        externalCallId: item.callId,
        direction: "INCOMING",
        status: crmStatus,
        caller,
        receiver,
        durationSec: durationSec ?? undefined,
        recordUrl,
      })) ?? messageId;
    if (messageId && messageId !== row.messageId) {
      await prisma.nvoipCallLog.update({
        where: { id: row.id },
        data: { messageId },
      });
    }
    broadcastConversationUpdated(account.organizationId, ctx.conversationId);
  }

  const activeInbound = !terminal && ["RINGING", "ACTIVE", "DIALING"].includes(crmStatus);
  const shouldScreenPop =
    activeInbound &&
    (isNew || (previousStatus !== "RINGING" && previousStatus !== "ACTIVE" && crmStatus === "RINGING"));

  if (shouldScreenPop) {
    await emitNvoipIncomingScreenPop({
      organizationId: account.organizationId,
      nvoipAccountId: account.id,
      externalCallId: item.callId,
      caller,
      receiver,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      accountExternalConfig: account.externalConfig,
    });
  }

  return { created: isNew, screenPop: shouldScreenPop };
}

export async function syncNvoipInboundHistoryForAccount(account: NvoipAccount): Promise<{
  processed: number;
  created: number;
  screenPops: number;
}> {
  let processed = 0;
  let created = 0;
  let screenPops = 0;

  for (const date of ["today", "yesterday"] as const) {
    let items: NvoipHistoryCallItem[];
    try {
      items = await nvoipGetCallHistory(account, "inbound", date);
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId: account.organizationId,
        nvoipAccountId: account.id,
        level: "warn",
        eventType: "history_sync_failed",
        message: err instanceof Error ? err.message : "history_sync_failed",
        payload: { date },
      });
      continue;
    }

    for (const item of items) {
      processed += 1;
      const result = await ingestNvoipInboundHistoryItem(account, item);
      if (result.created) created += 1;
      if (result.screenPop) screenPops += 1;
    }
  }

  await prisma.nvoipAccount.update({
    where: { id: account.id },
    data: { lastStatusAt: new Date() },
  });

  return { processed, created, screenPops };
}
