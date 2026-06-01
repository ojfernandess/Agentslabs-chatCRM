import { normalizeDialPhone } from "./threeCxCallContext.js";
import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import { ensureConversationForChannelInbox } from "./conversationRouting.js";
import { getDefaultInboxId } from "./defaultInbox.js";

export { normalizeDialPhone };

export async function findNvoipAccountInOrg(organizationId: string) {
  return prisma.nvoipAccount.findUnique({
    where: { organizationId },
  });
}

export async function resolveCallerForUser(
  organizationId: string,
  accountId: string,
  userId: string,
  defaultCaller: string,
  trunkId?: string | null,
): Promise<string> {
  const { resolveNvoipOutboundCaller } = await import("./nvoipTrunks.js");
  return resolveNvoipOutboundCaller({
    organizationId,
    accountId,
    userId,
    accountDefaultCaller: defaultCaller,
    trunkId,
  });
}

export async function resolveNvoipCallContext(input: {
  organizationId: string;
  nvoipAccountId: string;
  phone: string;
  contactId?: string | null;
  conversationId?: string | null;
}): Promise<{
  contactId: string | null;
  conversationId: string | null;
  dialPhone: string;
  contact: { id: string; name: string; phone: string } | null;
}> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { id: input.nvoipAccountId, organizationId: input.organizationId },
  });
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

  if (contactId && !conversationId && account) {
    const settings = await prisma.settings.findUnique({
      where: { organizationId: input.organizationId },
    });
    const inboxId = account.inboxId ?? (await getDefaultInboxId(input.organizationId));
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
