import { subMinutes } from "date-fns";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import {
  isNvoipTerminalState,
  isNvoipCrmStatusTerminal,
  mapNvoipStateToCrmStatus,
  nvoipCreateCall,
  nvoipFindCallInTodayHistory,
  nvoipGetCallStatus,
} from "./nvoipClient.js";
import {
  isNvoipCallLogActive,
  normalizeNvoipTerminalStatus,
  upsertNvoipTimelineMessage,
} from "./nvoipCallTimeline.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
import { resolveCallerForUser, resolveNvoipCallContext } from "./nvoipCallContext.js";
import { formatNvoipCalled, formatNvoipCaller, isValidNvoipOutboundCaller } from "./nvoipCallFormat.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

export async function startAgentOutboundCall(input: {
  organizationId: string;
  userId: string;
  userName: string;
  clientCallId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
  trunkId?: string | null;
}): Promise<
  | {
      ok: true;
      callId: string;
      dialPhone: string;
      caller: string;
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
    input.trunkId,
  );
  if (!caller) return { ok: false, message: "nvoip_no_caller" };

  const ctx = await resolveNvoipCallContext({
    organizationId: input.organizationId,
    nvoipAccountId: account.id,
    phone: input.phone,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
  });

  const receiver = formatNvoipCalled(ctx.dialPhone);
  const callerNorm = formatNvoipCaller(caller);
  if (!receiver || receiver.length < 10) {
    return { ok: false, message: "invalid_called_number" };
  }

  const sipUsers = await prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId: account.id },
    select: { numbersip: true, caller: true },
  });
  if (!isValidNvoipOutboundCaller(callerNorm, account.numbersip, sipUsers)) {
    await writeNvoipIntegrationLog({
      organizationId: input.organizationId,
      nvoipAccountId: account.id,
      level: "error",
      eventType: "outbound_call_invalid_caller",
      message: `Invalid caller=${callerNorm} (use a registered SIP user / ramal)`,
      payload: { caller: callerNorm, accountNumbersip: account.numbersip, called: receiver },
    });
    return { ok: false, message: "nvoip_invalid_caller_use_ramal" };
  }

  let externalCallId: string;
  try {
    const created = await nvoipCreateCall(account, callerNorm, receiver);
    externalCallId = created.callId;
    await writeNvoipIntegrationLog({
      organizationId: input.organizationId,
      nvoipAccountId: account.id,
      level: "info",
      eventType: "outbound_call_start",
      message: `POST /calls/ caller=${callerNorm} called=${receiver} callId=${created.callId} state=${created.state}`,
      payload: { caller: callerNorm, called: receiver, callId: created.callId, state: created.state },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create_call_failed";
    await writeNvoipIntegrationLog({
      organizationId: input.organizationId,
      nvoipAccountId: account.id,
      level: "error",
      eventType: "outbound_call_failed",
      message,
      payload: { caller: callerNorm, called: receiver },
    });
    return { ok: false, message };
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
    caller: callerNorm,
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
  nvoipState: string;
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
    return { status: "UNKNOWN", nvoipState: "", terminal: true, recordUrl: null, durationSec: null };
  }

  let remote: Awaited<ReturnType<typeof nvoipGetCallStatus>>;
  try {
    remote = await nvoipGetCallStatus(row.nvoipAccount, input.externalCallId);
  } catch {
    const history = await nvoipFindCallInTodayHistory(
      row.nvoipAccount,
      input.externalCallId,
      row.direction === "INCOMING" ? "inbound" : "outbound",
    );
    if (history) {
      remote = {
        state: history.state,
        linkAudio: history.linkAudio,
        talkingDurationSeconds: history.talkingDurationSeconds,
        totalDurationSeconds: history.totalDurationSeconds,
        caller: history.caller,
      };
    } else if (row.startedAt && Date.now() - row.startedAt.getTime() > 45_000) {
      remote = { state: "finished" };
    } else {
      throw new Error("call_status_unavailable");
    }
  }

  const nvoipState = String(remote.state ?? "");
  const crmStatus = mapNvoipStateToCrmStatus(nvoipState);
  const terminal =
    isNvoipTerminalState(nvoipState) ||
    isNvoipCrmStatusTerminal(crmStatus) ||
    (!nvoipState && row.startedAt != null && Date.now() - row.startedAt.getTime() > 120_000);
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
      endedAt: terminal ? new Date() : row.endedAt,
    },
  });

  if (terminal && row.clientCallId) {
    broadcastToOrganization(input.organizationId, {
      type: "nvoip.call.ended",
      callId: row.externalCallId,
      clientCallId: row.clientCallId,
      userId: row.initiatedByUserId,
      status: crmStatus,
    });
  }

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
    nvoipState,
    terminal,
    recordUrl,
    durationSec: durationSec ?? null,
  };
}

export async function claimNvoipCallAgent(input: {
  organizationId: string;
  userId: string;
  clientCallId?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  if (!input.clientCallId?.trim() && !input.conversationId) return;

  const log = await prisma.nvoipCallLog.findFirst({
    where: {
      organizationId: input.organizationId,
      endedAt: null,
      ...(input.clientCallId?.trim()
        ? { clientCallId: input.clientCallId.trim() }
        : { conversationId: input.conversationId!, createdAt: { gte: subMinutes(new Date(), 30) } }),
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!log || !isNvoipCallLogActive(log)) return;

  await prisma.nvoipCallLog.update({
    where: { id: log.id },
    data: { initiatedByUserId: input.userId },
  });
  if (log.conversationId) {
    broadcastConversationUpdated(input.organizationId, log.conversationId);
  }
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
