import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";

function clip(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 32);
}

async function linkPhone(organizationId: string, phone: string) {
  const found = await findContactByInboundPhone(prisma, organizationId, phone);
  if (!found) return { contactId: null as string | null, conversationId: null as string | null };
  const conversation = await prisma.conversation.findFirst({
    where: { organizationId, contactId: found.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return { contactId: found.id, conversationId: conversation?.id ?? null };
}

export async function startSipCallLog(input: {
  organizationId: string;
  userId: string;
  clientCallId: string;
  direction: "INCOMING" | "OUTGOING";
  phone: string;
}): Promise<void> {
  const creds = await prisma.userSipCredentials.findUnique({
    where: { userId: input.userId },
    select: { sipUser: true },
  });
  const extension = clip(creds?.sipUser ?? "");
  const remote = clip(input.phone);
  const caller = input.direction === "OUTGOING" ? extension || remote : remote;
  const receiver = input.direction === "OUTGOING" ? remote : extension || remote;
  const linked = await linkPhone(input.organizationId, remote);
  const now = new Date();

  await prisma.sipCallLog.upsert({
    where: { clientCallId: input.clientCallId },
    create: {
      clientCallId: input.clientCallId,
      organizationId: input.organizationId,
      initiatedByUserId: input.userId,
      direction: input.direction,
      caller: caller || "sip",
      receiver: receiver || "sip",
      status: "RINGING",
      startedAt: now,
      contactId: linked.contactId,
      conversationId: linked.conversationId,
    },
    update: {
      direction: input.direction,
      caller: caller || "sip",
      receiver: receiver || "sip",
      status: "RINGING",
      contactId: linked.contactId,
      conversationId: linked.conversationId,
    },
  });
}

export async function completeSipCallLog(input: {
  organizationId: string;
  userId: string;
  clientCallId: string;
  status: string;
  durationSec: number | null;
}): Promise<void> {
  const status = input.status.trim().toUpperCase().slice(0, 64) || "ENDED";
  await prisma.sipCallLog.updateMany({
    where: {
      clientCallId: input.clientCallId,
      organizationId: input.organizationId,
      initiatedByUserId: input.userId,
    },
    data: {
      status,
      durationSec: input.durationSec,
      endedAt: new Date(),
    },
  });
}
