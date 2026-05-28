import type { Contact, Conversation } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";

function sandboxPhoneForOrg(organizationId: string): string {
  const compact = organizationId.replace(/-/g, "").slice(0, 24);
  return `+oc-agent-test-${compact}`;
}

/** Conversa/contacto de sandbox por organização — permite tools nativas (ex.: atribuir_etiquetas) no test-chat. */
export async function ensureAgentProfileTestSandbox(organizationId: string): Promise<{
  contact: Contact;
  conversation: Conversation;
}> {
  const phone = sandboxPhoneForOrg(organizationId);
  let contact = await prisma.contact.findFirst({
    where: { organizationId, phone },
  });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: "Sandbox teste agente IA",
        optedIn: true,
      },
    });
  }

  const inboxId = await getDefaultInboxId(organizationId);
  let conversation = await prisma.conversation.findFirst({
    where: {
      organizationId,
      contactId: contact.id,
      inboxId,
      status: { not: "RESOLVED" },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId: contact.id,
        status: "PENDING",
      },
    });
  }

  return { contact, conversation };
}
