import { subMinutes } from "date-fns";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import {
  normalizeThreeCxTerminalStatus,
  upsertThreeCxTimelineMessage,
} from "./threeCxCallTimeline.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";
import { resolveThreeCxCallContext } from "./threeCxCallContext.js";
import { makeThreeCxOutboundCall } from "./threeCxCallControl.js";
import { fireTelephonyCrmTriggers } from "./crmFlowTelephonyHooks.js";

export function placeholderExternalCallId(clientCallId: string): string {
  return `pending:${clientCallId}`;
}

export async function startAgentOutboundCall(input: {
  organizationId: string;
  userId: string;
  userName: string;
  threeCxRoutePointId: string;
  clientCallId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
}): Promise<
  | { ok: true; dialPhone: string; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string }
> {
  const routePoint = await prisma.threeCxRoutePoint.findFirst({
    where: {
      id: input.threeCxRoutePointId,
      organizationId: input.organizationId,
      status: "CONNECTED",
    },
  });
  if (!routePoint) return { ok: false, message: "route_point_not_available" };

  const ctx = await resolveThreeCxCallContext({
    organizationId: input.organizationId,
    threeCxRoutePointId: input.threeCxRoutePointId,
    phone: input.phone,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
  });

  const externalCallId = placeholderExternalCallId(input.clientCallId);
  const receiver = ctx.dialPhone.slice(0, 32);
  const caller = (routePoint.sourceExtensionDn ?? routePoint.routePointDn).slice(0, 32);

  const callLog = await prisma.threeCxCallLog.upsert({
    where: {
      threeCxRoutePointId_externalCallId: {
        threeCxRoutePointId: routePoint.id,
        externalCallId,
      },
    },
    create: {
      organizationId: input.organizationId,
      threeCxRoutePointId: routePoint.id,
      externalCallId,
      direction: "OUTGOING",
      caller,
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
    },
  });

  const pbxResult = await makeThreeCxOutboundCall({
    pbxBaseUrl: routePoint.pbxBaseUrl,
    clientId: routePoint.clientId,
    apiKeyEnc: routePoint.apiKeyEnc,
    routePointDn: routePoint.routePointDn,
    sourceExtensionDn: routePoint.sourceExtensionDn,
    destination: ctx.dialPhone,
  });
  if (!pbxResult.ok) {
    await prisma.threeCxCallLog.updateMany({
      where: {
        threeCxRoutePointId: routePoint.id,
        externalCallId,
      },
      data: { status: "FAILED", endedAt: new Date() },
    });
    fireTelephonyCrmTriggers({
      organizationId: input.organizationId,
      provider: "3cx",
      callLogId: callLog.id,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      status: "FAILED",
      direction: "OUTGOING",
      phone: receiver,
      isTerminal: true,
    });
    return { ok: false, message: pbxResult.message };
  }

  fireTelephonyCrmTriggers({
    organizationId: input.organizationId,
    provider: "3cx",
    callLogId: callLog.id,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    status: "DIALING",
    direction: "OUTGOING",
    phone: receiver,
    isOutboundStart: true,
  });

  if (ctx.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: ctx.contactId,
      eventType: "threecx_call",
      channel: "3CX",
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
    const messageId = await upsertThreeCxTimelineMessage({
      conversationId: ctx.conversationId,
      externalCallId,
      clientCallId: input.clientCallId,
      direction: "OUTGOING",
      status: "DIALING",
      caller,
      receiver,
    });
    if (messageId) {
      await prisma.threeCxCallLog.updateMany({
        where: { threeCxRoutePointId: routePoint.id, externalCallId },
        data: { messageId },
      });
      broadcastConversationUpdated(input.organizationId, ctx.conversationId);
    }
  }

  return {
    ok: true,
    dialPhone: ctx.dialPhone,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
  };
}

export async function completeAgentOutboundCall(input: {
  organizationId: string;
  threeCxRoutePointId: string;
  clientCallId: string;
  status: string;
  durationSec?: number | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const externalCallId = placeholderExternalCallId(input.clientCallId);
  const row = await prisma.threeCxCallLog.findFirst({
    where: {
      organizationId: input.organizationId,
      threeCxRoutePointId: input.threeCxRoutePointId,
      externalCallId,
    },
  });
  if (!row) return { ok: false, message: "call_not_found" };

  const terminal = normalizeThreeCxTerminalStatus(input.status);
  await prisma.threeCxCallLog.update({
    where: { id: row.id },
    data: {
      status: terminal,
      durationSec: input.durationSec ?? row.durationSec,
      endedAt: new Date(),
    },
  });

  if (row.conversationId) {
    await upsertThreeCxTimelineMessage({
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

  fireTelephonyCrmTriggers({
    organizationId: input.organizationId,
    provider: "3cx",
    callLogId: row.id,
    contactId: row.contactId,
    conversationId: row.conversationId,
    status: terminal,
    direction: row.direction as "INCOMING" | "OUTGOING",
    phone: row.direction === "INCOMING" ? row.caller : row.receiver,
    isTerminal: true,
  });

  return { ok: true };
}

export async function findProvisionalThreeCxCallLog(
  threeCxRoutePointId: string,
  contactId: string | null,
  peerPhone?: string | null,
) {
  const recent = { gte: subMinutes(new Date(), 15) };
  if (contactId) {
    return prisma.threeCxCallLog.findFirst({
      where: {
        threeCxRoutePointId,
        contactId,
        externalCallId: { startsWith: "pending:" },
        createdAt: recent,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  const digits = (peerPhone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const candidates = await prisma.threeCxCallLog.findMany({
    where: {
      threeCxRoutePointId,
      externalCallId: { startsWith: "pending:" },
      clientCallId: { not: null },
      createdAt: recent,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return (
    candidates.find((c) => {
      const r = c.receiver.replace(/\D/g, "");
      return r === digits || r.endsWith(digits.slice(-10)) || digits.endsWith(r.slice(-10));
    }) ?? null
  );
}
