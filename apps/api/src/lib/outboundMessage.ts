import type { Prisma, Message, Conversation } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";
import { getWhatsAppProvider } from "../providers/factory.js";
import { appendTimelineEvent } from "./timeline.js";
import type { SendMessageInput } from "./messagePayload.js";

export type OutboundActor =
  | { kind: "user"; userId: string }
  | { kind: "agent_bot"; botId: string };

export async function deliverOutboundWhatsAppMessage(options: {
  organizationId: string;
  data: SendMessageInput;
  actor: OutboundActor;
  log: FastifyBaseLogger;
  /** Conversa nova quando ainda não existe (painel humano). */
  newConversation: { status: "OPEN" | "PENDING"; assignedToId?: string | null };
}): Promise<{ message: Message; conversation: Conversation }> {
  const { organizationId, data, actor, log, newConversation } = options;
  const { contactId, type, body, templateId, mediaUrl, mediaType, isPrivate } = data;

  if (actor.kind === "agent_bot" && isPrivate) {
    throw new Error("Agent bot cannot send private notes");
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
  });
  if (!contact) {
    throw new Error("Contact not found");
  }

  if (!isPrivate && type !== "TEMPLATE") {
    const lastInbound = await prisma.message.findFirst({
      where: {
        conversation: { contactId, organizationId },
        direction: "INBOUND",
      },
      orderBy: { createdAt: "desc" },
    });

    if (lastInbound) {
      const hoursSinceLastInbound =
        (Date.now() - lastInbound.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastInbound > WHATSAPP_SESSION_WINDOW_HOURS) {
        throw new Error("Outside 24-hour session window. Only template messages can be sent.");
      }
    }
  }

  let conversation = await prisma.conversation.findFirst({
    where: { organizationId, contactId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        organizationId,
        contactId,
        status: newConversation.status,
        assignedToId: newConversation.assignedToId ?? undefined,
      },
    });
  }

  let messageBody = body;
  if (type === "TEMPLATE" && templateId) {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) {
      throw new Error("Template not found");
    }
    messageBody = template.body;
  }

  let providerMsgId: string | undefined;
  if (!isPrivate) {
    try {
      const provider = await getWhatsAppProvider(organizationId);
      if (provider) {
        providerMsgId = await provider.sendMessage({
          to: contact.phone,
          type,
          body: messageBody,
          mediaUrl,
          mediaType,
        });
      }
    } catch (err) {
      log.error(err, "Failed to send message via WhatsApp provider");
    }
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      type,
      body: messageBody,
      mediaUrl,
      mediaType: mediaType ?? (type === "AUDIO" ? "audio/*" : undefined),
      isPrivate: Boolean(isPrivate),
      providerMsgId,
      status: isPrivate ? "SENT" : providerMsgId ? "SENT" : "FAILED",
    },
  });

  const actorUserId = actor.kind === "user" ? actor.userId : undefined;
  const payload: Record<string, unknown> = {
    messageId: message.id,
    conversationId: conversation.id,
    type,
    body: messageBody,
    mediaUrl: mediaUrl ?? null,
    isPrivate: Boolean(isPrivate),
    status: message.status,
  };
  if (actor.kind === "agent_bot") {
    payload.agentBotId = actor.botId;
  }

  await appendTimelineEvent({
    organizationId,
    subjectType: "CONTACT",
    subjectId: contactId,
    eventType: "message.outbound",
    channel: "whatsapp",
    payload: payload as Prisma.InputJsonValue,
    actorUserId,
    sourceId: message.id,
  }).catch((err) => {
    log.warn({ err }, "Failed to append contact timeline event");
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return { message, conversation };
}
