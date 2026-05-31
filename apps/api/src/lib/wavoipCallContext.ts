import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import { ensureConversationForChannelInbox } from "./conversationRouting.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import { normalizeLeadFinderPhone } from "./leadFinderPhone.js";

export function normalizeDialPhone(raw: string): string | null {
  return normalizeLeadFinderPhone(raw) ?? normalizePhoneE164(raw.trim());
}

async function resolveInboxIdForDevice(device: { inboxId: string | null }, organizationId: string): Promise<string> {
  if (device.inboxId) return device.inboxId;
  return getDefaultInboxId(organizationId);
}

export async function resolveWavoipCallContext(input: {
  organizationId: string;
  wavoipDeviceId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
}): Promise<{
  contactId: string | null;
  conversationId: string | null;
  dialPhone: string;
  contact: { id: string; name: string; phone: string } | null;
}> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: input.wavoipDeviceId, organizationId: input.organizationId },
    select: { id: true, inboxId: true },
  });
  if (!device) {
    const dialPhone = normalizeDialPhone(input.phone) ?? input.phone.trim();
    return {
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      dialPhone,
      contact: null,
    };
  }

  const dialPhone = normalizeDialPhone(input.phone) ?? input.phone.trim();
  let contactId = input.contactId ?? null;
  let conversationId = input.conversationId ?? null;
  let contact: { id: string; name: string; phone: string } | null = null;

  if (contactId) {
    contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId: input.organizationId },
      select: { id: true, name: true, phone: true },
    });
    contactId = contact?.id ?? null;
  }

  if (!contactId && dialPhone) {
    const found = await findContactByInboundPhone(prisma, input.organizationId, dialPhone);
    if (found) {
      contactId = found.id;
      contact = { id: found.id, name: found.name, phone: found.phone };
    }
  }

  if (contactId && !conversationId) {
    const settings = await prisma.settings.findUnique({ where: { organizationId: input.organizationId } });
    const inboxId = await resolveInboxIdForDevice(device, input.organizationId);
    const conv = await ensureConversationForChannelInbox({
      organizationId: input.organizationId,
      contactId,
      inboxId,
      lockSingleConversation: settings?.lockSingleConversation ?? true,
      activeConversationStatus: "OPEN",
      createDefaults: { status: "OPEN" },
    });
    conversationId = conv.id;
  }

  return { contactId, conversationId, dialPhone, contact };
}
