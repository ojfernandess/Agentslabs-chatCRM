import type { Conversation } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Escolhe ou cria a conversa WhatsApp do contacto.
 * lockSingleConversation: reutiliza a conversa mais recente e reabre RESOLVED (uma thread por contacto).
 */
export async function ensureConversationForWhatsAppContact(params: {
  organizationId: string;
  contactId: string;
  lockSingleConversation: boolean;
  /** Após reabrir RESOLVED, ou para promover PENDING → OPEN quando aplicável. */
  activeConversationStatus: "OPEN" | "PENDING";
  createDefaults: { status: "OPEN" | "PENDING"; assignedToId?: string | null };
}): Promise<Conversation> {
  const {
    organizationId,
    contactId,
    lockSingleConversation,
    activeConversationStatus,
    createDefaults,
  } = params;

  const promotePendingToOpen = activeConversationStatus === "OPEN";

  if (lockSingleConversation) {
    let conv = await prisma.conversation.findFirst({
      where: { organizationId, contactId },
      orderBy: { updatedAt: "desc" },
    });
    if (conv) {
      if (conv.status === "RESOLVED") {
        return prisma.conversation.update({
          where: { id: conv.id },
          data: { status: activeConversationStatus, updatedAt: new Date() },
        });
      }
      if (conv.status === "PENDING" && promotePendingToOpen) {
        return prisma.conversation.update({
          where: { id: conv.id },
          data: { status: "OPEN", updatedAt: new Date() },
        });
      }
      return conv;
    }
    return prisma.conversation.create({
      data: {
        organizationId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }

  let conv = await prisma.conversation.findFirst({
    where: { organizationId, contactId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conv) {
    return prisma.conversation.create({
      data: {
        organizationId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }
  if (conv.status === "PENDING" && promotePendingToOpen) {
    return prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "OPEN", updatedAt: new Date() },
    });
  }
  return conv;
}
