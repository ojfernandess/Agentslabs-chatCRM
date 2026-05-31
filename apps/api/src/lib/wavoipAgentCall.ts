import { subMinutes } from "date-fns";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import { upsertWavoipTimelineMessage } from "./wavoipCallTimeline.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";
import { resolveWavoipCallContext } from "./wavoipCallContext.js";

export function placeholderWhatsappCallId(clientCallId: string): number {
  let h = 5381;
  for (let i = 0; i < clientCallId.length; i++) {
    h = ((h << 5) + h + clientCallId.charCodeAt(i)) | 0;
  }
  const n = Math.abs(h);
  return n > 0 ? -n : -1;
}

export async function findProvisionalCallLog(
  wavoipDeviceId: string,
  contactId: string | null,
  peerPhone?: string | null,
) {
  const recent = { gte: subMinutes(new Date(), 15) };
  if (contactId) {
    return prisma.wavoipCallLog.findFirst({
      where: {
        wavoipDeviceId,
        contactId,
        whatsappCallId: { lt: 0 },
        createdAt: recent,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  const digits = (peerPhone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;

  const candidates = await prisma.wavoipCallLog.findMany({
    where: {
      wavoipDeviceId,
      whatsappCallId: { lt: 0 },
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

export async function startAgentOutboundCall(input: {
  organizationId: string;
  userId: string;
  userName: string;
  wavoipDeviceId: string;
  clientCallId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
}): Promise<
  | { ok: true; dialPhone: string; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string }
> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: input.wavoipDeviceId, organizationId: input.organizationId, status: "OPEN" },
  });
  if (!device) return { ok: false, message: "device_not_available" };

  const ctx = await resolveWavoipCallContext({
    organizationId: input.organizationId,
    wavoipDeviceId: input.wavoipDeviceId,
    phone: input.phone,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
  });

  const receiver = ctx.dialPhone.slice(0, 32);
  const caller = (device.linkedPhone ?? "").slice(0, 32);
  const placeholderId = placeholderWhatsappCallId(input.clientCallId);
  const contactId = ctx.contactId;
  const conversationId = ctx.conversationId;

  await prisma.wavoipCallLog.upsert({
    where: {
      wavoipDeviceId_whatsappCallId: {
        wavoipDeviceId: device.id,
        whatsappCallId: placeholderId,
      },
    },
    create: {
      organizationId: input.organizationId,
      wavoipDeviceId: device.id,
      whatsappCallId: placeholderId,
      idSession: 0,
      direction: "OUTGOING",
      caller,
      receiver,
      status: "CALLING",
      initiatedByUserId: input.userId,
      clientCallId: input.clientCallId,
      contactId,
      conversationId,
      startedAt: new Date(),
    },
    update: {
      status: "CALLING",
      startedAt: new Date(),
      initiatedByUserId: input.userId,
      clientCallId: input.clientCallId,
    },
  });

  if (contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: contactId,
      eventType: "wavoip_call",
      channel: "WAVOIP",
      actorUserId: input.userId,
      sourceId: input.clientCallId,
      payload: {
        title: "Chamada Wavoip — CALLING",
        direction: "OUTGOING",
        status: "CALLING",
        agentName: input.userName,
        durationSec: null,
        clientCallId: input.clientCallId,
      },
    });
  }

  if (conversationId) {
    broadcastConversationUpdated(input.organizationId, conversationId);
  }

  return { ok: true, dialPhone: ctx.dialPhone, contactId, conversationId };
}

export async function completeAgentOutboundCall(input: {
  organizationId: string;
  userId: string;
  userName: string;
  clientCallId: string;
  status: string;
  durationSec?: number | null;
}): Promise<void> {
  const log = await prisma.wavoipCallLog.findFirst({
    where: { organizationId: input.organizationId, clientCallId: input.clientCallId },
    include: { wavoipDevice: { select: { linkedPhone: true } } },
  });
  if (!log) return;

  const terminal = ["ENDED", "REJECTED", "NOT_ANSWERED", "FAILED", "DISCONNECTED"].includes(
    input.status.toUpperCase(),
  );
  const now = new Date();

  await prisma.wavoipCallLog.update({
    where: { id: log.id },
    data: {
      status: input.status.toUpperCase(),
      durationSec: input.durationSec ?? log.durationSec,
      endedAt: terminal ? now : log.endedAt,
      initiatedByUserId: log.initiatedByUserId ?? input.userId,
    },
  });

  if (log.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: log.contactId,
      eventType: "wavoip_call",
      channel: "WAVOIP",
      actorUserId: log.initiatedByUserId ?? input.userId,
      sourceId: `${input.clientCallId}:${input.status.toUpperCase()}`,
      payload: {
        title: `Chamada Wavoip — ${input.status.toUpperCase()}`,
        direction: log.direction,
        status: input.status.toUpperCase(),
        agentName: input.userName,
        durationSec: input.durationSec ?? log.durationSec,
        clientCallId: input.clientCallId,
      },
    });
  }

  if (log.conversationId && terminal) {
    const messageId = await upsertWavoipTimelineMessage({
      conversationId: log.conversationId,
      whatsappCallId: log.whatsappCallId,
      clientCallId: log.clientCallId,
      direction: log.direction,
      status: input.status.toUpperCase(),
      caller: log.caller,
      receiver: log.receiver,
      durationSec: input.durationSec ?? log.durationSec,
    });
    if (messageId) {
      await prisma.wavoipCallLog.update({ where: { id: log.id }, data: { messageId } });
    }
    broadcastConversationUpdated(input.organizationId, log.conversationId);
  }
}
