import type { Prisma, Message, Conversation } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";
import { getWhatsAppProvider } from "../providers/factory.js";
import { appendTimelineEvent } from "./timeline.js";
import type { SendMessageInput } from "./messagePayload.js";
import { ensureConversationForWhatsAppContact } from "./conversationRouting.js";

import type { MessageTemplate } from "@prisma/client";
import { substituteBodyPlaceholders } from "./templateVariables.js";

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
  /**
   * Anexa a mensagem a esta conversa (ex.: inquérito CSAT após RESOLVED), sem passar pelo
   * roteamento que poderia reabrir OUTRA conversa com `lockSingleConversation`.
   */
  pinnedConversationId?: string;
}): Promise<{ message: Message; conversation: Conversation }> {
  const { organizationId, data, actor, log, newConversation, pinnedConversationId } = options;
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

  const channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  const lockSingleConversation = channelSettings?.lockSingleConversation ?? false;
  const providerKind = channelSettings?.whatsappProvider;
  const isMetaProvider = providerKind === "meta" || providerKind === "360dialog";
  const botTriageActive =
    Boolean(channelSettings?.agentBotId) &&
    Boolean(channelSettings?.agentBot?.isActive) &&
    Boolean(channelSettings?.agentBot?.webhookUrl?.trim());

  const activeConversationStatus: "OPEN" | "PENDING" =
    actor.kind === "user" ? "OPEN" : botTriageActive ? "PENDING" : "OPEN";

  let conversation: Conversation;
  if (pinnedConversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: pinnedConversationId, organizationId, contactId },
    });
    if (!conv) {
      throw new Error("Conversation not found");
    }
    conversation = conv;
  } else {
    conversation = await ensureConversationForWhatsAppContact({
      organizationId,
      contactId,
      lockSingleConversation,
      activeConversationStatus,
      createDefaults: {
        status: newConversation.status,
        assignedToId: newConversation.assignedToId ?? null,
      },
    });
  }

  let templateRow: MessageTemplate | null = null;
  let messageBody = body;
  if (type === "TEMPLATE" && templateId) {
    templateRow = await prisma.messageTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!templateRow) {
      throw new Error("Template not found");
    }
    const params = data.templateBodyParameters ?? [];
    if (templateRow.bodyVariableCount > 0 && params.length !== templateRow.bodyVariableCount) {
      throw new Error(
        `Template requires exactly ${templateRow.bodyVariableCount} variable(s) for the message body`,
      );
    }
    messageBody = substituteBodyPlaceholders(templateRow.body, params);
  } else if (type === "TEMPLATE") {
    throw new Error("Template not found");
  }

  if (type === "TEMPLATE" && !isPrivate && isMetaProvider && templateRow) {
    if (!templateRow.providerTemplateId?.trim()) {
      throw new Error(
        "Template is missing the WhatsApp Business template name. Reload templates (sync runs when you open the list) or pick a synced model.",
      );
    }
  }

  let providerMsgId: string | undefined;
  if (!isPrivate) {
    try {
      const provider = await getWhatsAppProvider(organizationId);
      if (provider) {
        const to =
          contact.waId && contact.waId.includes("@g.us") ? contact.waId : contact.phone;
        providerMsgId = await provider.sendMessage({
          to,
          type,
          body: messageBody ?? "",
          mediaUrl,
          mediaType,
          ...(type === "TEMPLATE" && isMetaProvider && templateRow?.providerTemplateId
            ? {
                templateName: templateRow.providerTemplateId,
                templateLanguage: templateRow.templateLanguage,
                templateBodyParameters:
                  templateRow.bodyVariableCount > 0 ? (data.templateBodyParameters ?? []) : undefined,
              }
            : {}),
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
      actorUserId: actor.kind === "user" ? actor.userId : null,
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
