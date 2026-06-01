import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import {
  isNvoipTerminalState,
  mapNvoipStateToCrmStatus,
  nvoipCreateCall,
  nvoipGetCallStatus,
} from "./nvoipClient.js";
import {
  normalizeNvoipTerminalStatus,
  upsertNvoipTimelineMessage,
} from "./nvoipCallTimeline.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";
import { resolveCallerForUser, resolveNvoipCallContext } from "./nvoipCallContext.js";

export async function startAgentOutboundCall(input: {
  organizationId: string;
  userId: string;
  userName: string;
  clientCallId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
}): Promise<
  | {
      ok: true;
      callId: string;
      dialPhone: string;
      contactId: string | null;
      conversationId: string | null;
    }
  | { ok: false; message: string }
> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId: input.organizationId, status: "CONNECTED" },
  });
  if (!account) return { ok: false, message: "nvoip_not_configured" };

  const caller = await resolveCallerForUser(
    input.organizationId,
    account.id,
    input.userId,
    account.defaultCaller,
  );
  if (!caller) return { ok: false, message: "nvoip_no_caller" };

  const ctx = await resolveNvoipCallContext({
    organizationId: input.organizationId,
    nvoipAccountId: account.id,
    phone: input.phone,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
  });

  const receiver = ctx.dialPhone.replace(/\D/g, "").slice(0, 32);
  const callerNorm = caller.replace(/\D/g, "").slice(0, 32) || caller;

  let externalCallId: string;
  try {
    const created = await nvoipCreateCall(account, callerNorm, receiver);
    externalCallId = created.callId;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "create_call_failed" };
  }

  await prisma.nvoipCallLog.upsert({
    where: {
      nvoipAccountId_externalCallId: {
        nvoipAccountId: account.id,
        externalCallId,
      },
    },
    create: {
      organizationId: input.organizationId,
      nvoipAccountId: account.id,
      externalCallId,
      direction: "OUTGOING",
      caller: callerNorm,
      receiver,
      status: "DIALING",
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      initiatedByUserId: input.userId,
      clientCallId: input.clientCallId,
      startedAt: new Date(),
    },
    update: {
      status: "DIALING",
      receiver,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      clientCallId: input.clientCallId,
    },
  });

  if (ctx.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: ctx.contactId,
      eventType: "nvoip_call",
      channel: "NVOIP",
      actorUserId: input.userId,
      sourceId: input.clientCallId,
      payload: {
        title: `Chamada para ${receiver}`,
        direction: "OUTGOING",
        status: "DIALING",
        agentName: input.userName,
        clientCallId: input.clientCallId,
      },
    });
  }

  if (ctx.conversationId) {
    const messageId = await upsertNvoipTimelineMessage({
      conversationId: ctx.conversationId,
      externalCallId,
      clientCallId: input.clientCallId,
      direction: "OUTGOING",
      status: "DIALING",
      caller: callerNorm,
      receiver,
    });
    if (messageId) {
      await prisma.nvoipCallLog.updateMany({
        where: { nvoipAccountId: account.id, externalCallId },
        data: { messageId },
      });
      broadcastConversationUpdated(input.organizationId, ctx.conversationId);
    }
  }

  return {
    ok: true,
    callId: externalCallId,
    dialPhone: ctx.dialPhone,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
  };
}

export async function syncNvoipCallFromApi(input: {
  organizationId: string;
  externalCallId: string;
  clientCallId?: string | null;
}): Promise<{
  status: string;
  terminal: boolean;
  recordUrl: string | null;
  durationSec: number | null;
}> {
  const row = await prisma.nvoipCallLog.findFirst({
    where: {
      organizationId: input.organizationId,
      externalCallId: input.externalCallId,
    },
    include: { nvoipAccount: true },
  });
  if (!row?.nvoipAccount) {
    return { status: "UNKNOWN", terminal: true, recordUrl: null, durationSec: null };
  }

  const remote = await nvoipGetCallStatus(row.nvoipAccount, input.externalCallId);
  const crmStatus = mapNvoipStateToCrmStatus(String(remote.state ?? ""));
  const durationSec =
    remote.talkingDurationSeconds != null
      ? Number(remote.talkingDurationSeconds)
      : row.durationSec;
  const recordUrl = remote.linkAudio?.trim() ?? row.recordUrl;

  await prisma.nvoipCallLog.update({
    where: { id: row.id },
    data: {
      status: crmStatus,
      durationSec: Number.isFinite(durationSec) ? durationSec : row.durationSec,
      recordUrl,
      rawPayload: remote as object,
      endedAt: isNvoipTerminalState(String(remote.state ?? "")) ? new Date() : row.endedAt,
    },
  });

  if (row.conversationId) {
    await upsertNvoipTimelineMessage({
      conversationId: row.conversationId,
      externalCallId: row.externalCallId,
      clientCallId: row.clientCallId ?? input.clientCallId,
      direction: row.direction,
      status: crmStatus,
      caller: row.caller,
      receiver: row.receiver,
      durationSec: durationSec ?? undefined,
      recordUrl,
    });
    broadcastConversationUpdated(input.organizationId, row.conversationId);
  }

  return {
    status: crmStatus,
    terminal: isNvoipTerminalState(String(remote.state ?? "")),
    recordUrl,
    durationSec: durationSec ?? null,
  };
}

export async function completeAgentOutboundCall(input: {
  organizationId: string;
  clientCallId: string;
  externalCallId?: string | null;
  status: string;
  durationSec?: number | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const row = input.externalCallId
    ? await prisma.nvoipCallLog.findFirst({
        where: {
          organizationId: input.organizationId,
          externalCallId: input.externalCallId,
        },
      })
    : await prisma.nvoipCallLog.findFirst({
        where: {
          organizationId: input.organizationId,
          clientCallId: input.clientCallId,
        },
      });
  if (!row) return { ok: false, message: "call_not_found" };

  const terminal = normalizeNvoipTerminalStatus(input.status);
  await prisma.nvoipCallLog.update({
    where: { id: row.id },
    data: {
      status: terminal,
      durationSec: input.durationSec ?? row.durationSec,
      endedAt: new Date(),
    },
  });

  if (row.conversationId) {
    await upsertNvoipTimelineMessage({
      conversationId: row.conversationId,
      externalCallId: row.externalCallId,
      clientCallId: row.clientCallId,
      direction: row.direction,
      status: terminal,
      caller: row.caller,
      receiver: row.receiver,
      durationSec: input.durationSec ?? row.durationSec,
      recordUrl: row.recordUrl,
    });
    broadcastConversationUpdated(input.organizationId, row.conversationId);
  }

  return { ok: true };
}
