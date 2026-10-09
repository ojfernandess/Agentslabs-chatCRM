import { prisma } from "../db.js";
import { findContactByInboundPhone, phoneMatchSuffix } from "./contactPhoneMatch.js";
import { sipInboundLeadPhone } from "./sipInboundLead.js";

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

async function findContactByMobileSuffix(organizationId: string, phone: string) {
  const suffix = phoneMatchSuffix(phone);
  if (suffix.length < 10) return null;
  const rows = await prisma.contact.findMany({
    where: { organizationId, mobilePhone: { endsWith: suffix } },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });
  return rows.find((row) => phoneMatchSuffix(row.mobilePhone ?? "") === suffix) ?? null;
}

/** Liga a um contato existente ou cria o lead na primeira ligação recebida. */
async function linkOrCreateInboundSipContact(organizationId: string, phone: string, userId: string) {
  const leadPhone = sipInboundLeadPhone(phone);
  const lookup = leadPhone ?? clip(phone);
  if (!lookup) return { contactId: null as string | null, conversationId: null as string | null };

  const existing =
    (await findContactByInboundPhone(prisma, organizationId, lookup)) ??
    (leadPhone ? await findContactByMobileSuffix(organizationId, leadPhone) : null);
  if (existing) return linkPhone(organizationId, existing.phone);
  if (!leadPhone) return { contactId: null as string | null, conversationId: null as string | null };

  try {
    const created = await prisma.contact.create({
      data: {
        organizationId,
        phone: leadPhone,
        name: leadPhone.slice(0, 255),
        notes: "[SIP] Lead captado em ligação recebida",
        createdById: userId,
      },
    });
    return { contactId: created.id, conversationId: null as string | null };
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "P2002") {
      const raced = await findContactByInboundPhone(prisma, organizationId, leadPhone);
      if (raced) return linkPhone(organizationId, raced.phone);
    }
    return { contactId: null as string | null, conversationId: null as string | null };
  }
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
  const linked =
    input.direction === "INCOMING"
      ? await linkOrCreateInboundSipContact(input.organizationId, input.phone, input.userId)
      : await linkPhone(input.organizationId, remote);
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
