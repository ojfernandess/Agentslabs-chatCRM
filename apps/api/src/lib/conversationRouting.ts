import type { Conversation } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";

/**
 * Com agent bot ativo pedimos `activeConversationStatus === "PENDING"`.
 * Conversas antigas em `OPEN` sem atendente continuavam nesse estado — `dispatchAgentBotWebhook` só corre em `PENDING`,
 * por isso o bot nunca era notificado. Reabre para a fila do bot quando ainda não há atribuição humana.
 */
async function triageOpenUnassignedForAgentBot(
  conv: Conversation,
  activeConversationStatus: "OPEN" | "PENDING",
): Promise<Conversation> {
  if (activeConversationStatus !== "PENDING") {
    return conv;
  }
  if (conv.status !== "OPEN" || conv.assignedToId != null) {
    return conv;
  }
  return prisma.conversation.update({
    where: { id: conv.id },
    data: { status: "PENDING", updatedAt: new Date() },
  });
}

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
      return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
    }
    const inboxId = await getDefaultInboxId(organizationId);
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
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
    const inboxId = await getDefaultInboxId(organizationId);
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
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
  return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
}

/**
 * Conversa numa caixa explícita (canais API / widget / SMS / Telegram / …).
 * Escopo por `inboxId` para o mesmo contacto poder existir em várias caixas.
 */
export async function ensureConversationForChannelInbox(params: {
  organizationId: string;
  contactId: string;
  inboxId: string;
  lockSingleConversation: boolean;
  activeConversationStatus: "OPEN" | "PENDING";
  createDefaults: { status: "OPEN" | "PENDING"; assignedToId?: string | null };
}): Promise<Conversation> {
  const {
    organizationId,
    contactId,
    inboxId,
    lockSingleConversation,
    activeConversationStatus,
    createDefaults,
  } = params;

  const promotePendingToOpen = activeConversationStatus === "OPEN";

  if (lockSingleConversation) {
    let conv = await prisma.conversation.findFirst({
      where: { organizationId, contactId, inboxId },
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
      return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
    }
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }

  let conv = await prisma.conversation.findFirst({
    where: { organizationId, contactId, inboxId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conv) {
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
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
  return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
}
