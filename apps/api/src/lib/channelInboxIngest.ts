import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { InboxChannelType, MessageType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { appendTimelineEvent } from "./timeline.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";
import { dispatchAgentBotWebhook } from "./agentBotWebhook.js";
import { maybeTranscribeInboundAudioMessage } from "./audioTranscription.js";
import { maybeTranscribeInboundImageMessage } from "./imageTranscription.js";
import { getAgentBotDispatchContextForInbox } from "./agentBotTriage.js";
import { findConversationByEmailThreadHeaders } from "./emailThreadRouting.js";
import { ensureConversationForChannelInbox, reopenResolvedConversationData } from "./conversationRouting.js";
import { tryAutoAssignInboxConversation } from "./inboxAutoAssignment.js";
import { fireCrmFlowTriggers } from "./crmFlowHooks.js";
import { applyPreChatFormToContact, mergeContactNotes } from "./preChatContactSync.js";

export function newIngestToken(): string {
  return randomBytes(32).toString("hex");
}

/** Normaliza identificador do participante (e-mail sempre em minúsculas). */
export function normalizeChannelParticipantId(channelType: InboxChannelType, participantId: string): string {
  const trimmed = participantId.replace(/\|/g, "_").replace(/\s+/g, " ").trim().slice(0, 400);
  if (channelType === "EMAIL") return trimmed.toLowerCase();
  return trimmed;
}

/** Chave única por participante + canal (evita colidir com telefones E.164). */
export function participantPhoneKey(channelType: InboxChannelType, participantId: string): string {
  const safeId = normalizeChannelParticipantId(channelType, participantId);
  return `oc|${channelType}|${safeId}`;
}

export type ChannelInboundInput = {
  organizationId: string;
  inboxId: string;
  channelType: InboxChannelType;
  participantId: string;
  participantName?: string;
  email?: string | null;
  visitorPhone?: string | null;
  preChatFormData?: Record<string, string> | null;
  body?: string | null;
  type?: MessageType;
  mediaUrl?: string | null;
  mediaType?: string | null;
  externalMessageId?: string | null;
  /** IDs RFC5322 (In-Reply-To / References) para encadear respostas de e-mail. */
  emailThreadMessageIds?: string[];
  log: FastifyBaseLogger;
};

export async function processChannelInboxInbound(input: ChannelInboundInput): Promise<{
  conversationId: string;
  messageId: string;
  contactId: string;
  accepted: boolean;
}> {
  const {
    organizationId,
    inboxId,
    channelType,
    participantId,
    participantName,
    email,
    visitorPhone,
    preChatFormData,
    body,
    type = "TEXT",
    mediaUrl,
    mediaType,
    externalMessageId,
    emailThreadMessageIds,
    log,
  } = input;

  const normalizedParticipantId = normalizeChannelParticipantId(channelType, participantId);
  const phone = participantPhoneKey(channelType, normalizedParticipantId);
  const preChatUpdates = applyPreChatFormToContact({
    participantName,
    email,
    visitorPhone,
    preChatFormData,
  });
  const displayName =
    preChatUpdates.name?.trim() ||
    participantName?.trim() ||
    (channelType === "EMAIL" && email ? email : null) ||
    participantId;

  let contactJustCreated = false;
  let contact = await prisma.contact.findFirst({
    where: { organizationId, phone },
  });
  if (!contact && channelType === "EMAIL") {
    contact = await prisma.contact.findFirst({
      where: {
        organizationId,
        email: { equals: normalizedParticipantId, mode: "insensitive" },
      },
    });
    if (contact && contact.phone !== phone) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { phone },
      });
    }
  }
  if (!contact) {
    contactJustCreated = true;
    contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: displayName,
        email:
          preChatUpdates.email?.trim() ||
          email?.trim() ||
          (channelType === "EMAIL" ? normalizedParticipantId : undefined) ||
          undefined,
        notes: preChatUpdates.notes,
      },
    });
  } else {
    const updates: { email?: string; name?: string; notes?: string } = {};
    if (preChatUpdates.email?.trim()) updates.email = preChatUpdates.email.trim();
    else if (email?.trim() && !contact.email) updates.email = email.trim();

    if (preChatUpdates.name?.trim()) updates.name = preChatUpdates.name.trim();
    else if (participantName?.trim() && contact.name !== participantName.trim()) {
      updates.name = participantName.trim();
    }

    if (preChatUpdates.notes) {
      updates.notes = mergeContactNotes(contact.notes, preChatUpdates.notes);
    } else if (visitorPhone?.trim()) {
      const noteLine = `Telefone: ${visitorPhone.trim()}`;
      if (!contact.notes?.includes(visitorPhone.trim())) {
        updates.notes = contact.notes ? `${contact.notes}\n${noteLine}` : noteLine;
      }
    }

    if (Object.keys(updates).length > 0) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: updates,
      });
    }
  }

  if (contact.isBlocked) {
    log.info(
      { organizationId, contactId: contact.id, channelType, inboxId },
      "Inbound message ignored: contact is blocked",
    );
    return { conversationId: "", messageId: "", contactId: contact.id, accepted: false };
  }

  if (externalMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        providerMsgId: externalMessageId,
        conversation: { organizationId, inboxId },
      },
      select: {
        id: true,
        body: true,
        conversationId: true,
        conversation: { select: { contactId: true } },
      },
    });
    if (existing) {
      // Upgrade plain-text bodies to HTML when re-syncing the same IMAP message.
      if (
        channelType === "EMAIL" &&
        type === "TEXT" &&
        body &&
        body.includes("<!--oc-email-html-->") &&
        existing.body &&
        !existing.body.includes("<!--oc-email-html-->")
      ) {
        await prisma.message.update({
          where: { id: existing.id },
          data: { body },
        });
      }
      return {
        conversationId: existing.conversationId,
        messageId: existing.id,
        contactId: existing.conversation.contactId,
        accepted: true,
      };
    }
  }

  const channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  const lockSingleConversation = channelSettings?.lockSingleConversation ?? false;
  const audioTranscriptionEnabled = channelSettings?.audioTranscriptionEnabled ?? false;
  const imageTranscriptionEnabled = channelSettings?.imageTranscriptionEnabled ?? false;
  const agentCtx = await getAgentBotDispatchContextForInbox(organizationId, inboxId);
  const useAgentBot = Boolean(agentCtx);

  const conversationCreatedAtBefore = Date.now();
  const activeStatus = useAgentBot ? "PENDING" : "OPEN";
  let conversation =
    channelType === "EMAIL" && emailThreadMessageIds && emailThreadMessageIds.length > 0
      ? await findConversationByEmailThreadHeaders({
          organizationId,
          inboxId,
          messageIds: emailThreadMessageIds,
        })
      : null;

  if (conversation?.status === "RESOLVED") {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: reopenResolvedConversationData(activeStatus),
    });
  } else if (conversation?.deletedAt) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { deletedAt: null },
    });
  } else if (conversation) {
    conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  }

  if (!conversation) {
    conversation = await ensureConversationForChannelInbox({
      organizationId,
      contactId: contact.id,
      inboxId,
      lockSingleConversation,
      activeConversationStatus: activeStatus,
      createDefaults: {
        status: activeStatus,
        assignedToId: null,
      },
    });
  }

  if (!useAgentBot && conversation.status === "OPEN" && conversation.assignedToId == null) {
    const assigned = await tryAutoAssignInboxConversation({
      conversationId: conversation.id,
      inboxId,
      organizationId,
      log,
    });
    if (assigned) {
      const refreshed = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      if (refreshed) conversation = refreshed;
    }
  }

  const inbound = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      type,
      body: body ?? null,
      mediaUrl: mediaUrl ?? null,
      mediaType: mediaType ?? null,
      providerMsgId: externalMessageId ?? null,
      status: "DELIVERED",
    },
  });

  let inboundForPipeline = await maybeTranscribeInboundAudioMessage({
    message: inbound,
    enabled: audioTranscriptionEnabled,
    log,
  });
  inboundForPipeline = await maybeTranscribeInboundImageMessage({
    message: inboundForPipeline,
    enabled: imageTranscriptionEnabled,
    log,
  });

  const channelTag = channelType.toLowerCase();

  await appendTimelineEvent({
    organizationId,
    subjectType: "CONTACT",
    subjectId: contact.id,
    eventType: "message.inbound",
    channel: channelTag,
    payload: {
      messageId: inbound.id,
      conversationId: conversation.id,
      type,
      body: inboundForPipeline.body ?? null,
      mediaUrl: mediaUrl ?? null,
      providerMsgId: externalMessageId ?? null,
      inboxId,
    } as Prisma.InputJsonValue,
    sourceId: externalMessageId ?? inbound.id,
    occurredAt: new Date(),
  }).catch((err) => {
    log.warn({ err }, "channel inbox: timeline append failed");
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  const inboundBody = inboundForPipeline.body?.trim() ?? "";
  if (inboundBody) {
    const rules = await prisma.autoTagRule.findMany({ where: { organizationId } });
    for (const rule of rules) {
      if (inboundBody.toLowerCase().includes(rule.keyword.toLowerCase())) {
        await prisma.contactTag.upsert({
          where: {
            contactId_tagId: { contactId: contact.id, tagId: rule.tagId },
          },
          create: { contactId: contact.id, tagId: rule.tagId },
          update: {},
        });
      }
    }
  }

  if (useAgentBot && agentCtx) {
    const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
    if (fresh) {
      void dispatchAgentBotWebhook({
        organizationId,
        settings: {
          agentBotId: agentCtx.agentBotId,
          agentBot: agentCtx.agentBot,
        },
        conversation: fresh,
        contact,
        message: inboundForPipeline,
        log,
      });
    }
  }

  broadcastConversationUpdated(organizationId, conversation.id);

  const conversationJustCreated =
    conversation.createdAt.getTime() >= conversationCreatedAtBefore - 2000;

  if (contactJustCreated) {
    fireCrmFlowTriggers(
      organizationId,
      "lead_created",
      { contactId: contact.id, inboxId, source: channelType },
      log,
    );
  }
  if (conversationJustCreated) {
    fireCrmFlowTriggers(
      organizationId,
      "conversation_started",
      {
        conversationId: conversation.id,
        contactId: contact.id,
        inboxId,
        channel: channelType,
      },
      log,
    );
  }
  fireCrmFlowTriggers(
    organizationId,
    "message_received",
    {
      messageId: inbound.id,
      conversationId: conversation.id,
      contactId: contact.id,
      body: inboundForPipeline.body ?? "",
      inboxId,
      channel: channelType,
    },
    log,
  );

  return {
    conversationId: conversation.id,
    messageId: inbound.id,
    contactId: contact.id,
    accepted: true,
  };
}
