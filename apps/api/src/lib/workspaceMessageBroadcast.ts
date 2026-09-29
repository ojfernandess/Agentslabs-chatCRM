import type { MessageDirection, MessageStatus, MessageType } from "@prisma/client";
import { prisma } from "../db.js";
import type { MessageReactionApiRow } from "./messageReactions.js";
import type { MessageReplyToApi } from "./messageReply.js";
import { messageReplyToInclude, resolveMessageReplyForApi } from "./messageReply.js";
import {
  broadcastConversationUpdated,
  broadcastToConversation,
  broadcastToOrganization,
} from "./workspaceHub.js";
import {
  encodeConversationMessageCursor,
  messageRowToCursor,
} from "./conversationMessageCursor.js";

export type WorkspaceMessagePayload = {
  id: string;
  direction: MessageDirection | string;
  type: MessageType | string;
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isPrivate?: boolean;
  status: MessageStatus | string;
  providerError?: string | null;
  sentAt: string;
  createdAt: string;
  channel?: string | null;
  cursor?: string | null;
  actorUser?: {
    id: string;
    name: string;
    displayName: string | null;
    showAgentNameInChat?: boolean;
  } | null;
  replyTo?: MessageReplyToApi | null;
};

type MessageLike = {
  id: string;
  direction: MessageDirection | string;
  type: MessageType | string;
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isPrivate?: boolean;
  status: MessageStatus | string;
  providerError?: string | null;
  sentAt?: Date;
  createdAt: Date;
  channel?: string | null;
  actorUserId?: string | null;
  actorUser?: {
    id: string;
    name: string;
    displayName: string | null;
    showAgentNameInChat: boolean;
  } | null;
};

const actorUserSelect = {
  id: true,
  name: true,
  displayName: true,
  showAgentNameInChat: true,
} as const;

type SerializeMessageWsOptions = {
  contactName?: string;
  replyTo?: MessageReplyToApi | null;
};

export function serializeMessageForWorkspaceWs(
  message: MessageLike,
  options?: SerializeMessageWsOptions,
): WorkspaceMessagePayload {
  const sentAt = message.sentAt ?? message.createdAt;
  const replyTo =
    options?.replyTo ??
    (options?.contactName && "replyTo" in message
      ? resolveMessageReplyForApi(
          message as {
            replyToMessageId?: string | null;
            replyToExternalMsgId?: string | null;
            replyTo?: Parameters<typeof resolveMessageReplyForApi>[0]["replyTo"];
          },
          options.contactName,
        )
      : null);
  return {
    id: message.id,
    direction: message.direction,
    type: message.type,
    body: message.body,
    mediaUrl: message.mediaUrl ?? null,
    mediaType: message.mediaType ?? null,
    isPrivate: message.isPrivate ?? false,
    status: message.status,
    providerError: message.providerError ?? null,
    sentAt: sentAt.toISOString(),
    createdAt: message.createdAt.toISOString(),
    channel: message.channel ?? null,
    cursor: encodeConversationMessageCursor(messageRowToCursor({ id: message.id, createdAt: message.createdAt })),
    actorUser: message.actorUser
      ? {
          id: message.actorUser.id,
          name: message.actorUser.name,
          displayName: message.actorUser.displayName,
          showAgentNameInChat: message.actorUser.showAgentNameInChat,
        }
      : null,
    replyTo: replyTo ?? null,
  };
}

export async function loadMessageForWorkspaceWs(messageId: string): Promise<WorkspaceMessagePayload | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      actorUser: { select: actorUserSelect },
      replyTo: messageReplyToInclude,
      conversation: { select: { contact: { select: { name: true } } } },
    },
  });
  return row
    ? serializeMessageForWorkspaceWs(row, {
        contactName: row.conversation.contact.name,
        replyTo: resolveMessageReplyForApi(row, row.conversation.contact.name),
      })
    : null;
}

export function broadcastConversationMessageCreated(
  organizationId: string,
  conversationId: string,
  message: WorkspaceMessagePayload,
): void {
  broadcastToConversation(organizationId, conversationId, {
    type: "message.created",
    conversationId,
    message,
  });
}

export function broadcastConversationMessageUpdated(
  organizationId: string,
  conversationId: string,
  message: Pick<WorkspaceMessagePayload, "id" | "status" | "providerError"> & {
    body?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
  },
): void {
  broadcastToConversation(organizationId, conversationId, {
    type: "message.updated",
    conversationId,
    message,
  });
}

export function broadcastConversationMessageReactionsUpdated(
  organizationId: string,
  conversationId: string,
  messageId: string,
  reactions: MessageReactionApiRow[],
): void {
  broadcastToConversation(organizationId, conversationId, {
    type: "message.reactions_updated",
    conversationId,
    message: { id: messageId, reactions },
  });
}

function conversationUpdatedBroadcastHasStructuralFields(
  extra?: {
    awaitingHumanHandoff?: boolean;
    status?: string;
    assignedToId?: string | null;
    teamId?: string | null;
    inboxId?: string;
    agentBotTriageActive?: boolean;
  },
): boolean {
  if (!extra) return false;
  return (
    extra.awaitingHumanHandoff !== undefined ||
    Boolean(extra.status) ||
    extra.assignedToId !== undefined ||
    extra.teamId !== undefined ||
    Boolean(extra.inboxId) ||
    extra.agentBotTriageActive !== undefined
  );
}

/** Push da mensagem nova + sinal de conversa actualizada (lista lateral / metadados). */
export function notifyConversationNewMessage(
  organizationId: string,
  conversationId: string,
  message: WorkspaceMessagePayload,
  extra?: { awaitingHumanHandoff?: boolean },
): void {
  broadcastConversationMessageCreated(organizationId, conversationId, message);
  // Fase 4 — evita `conversation.updated` só por nova mensagem (clientes usam message.created).
  if (conversationUpdatedBroadcastHasStructuralFields(extra)) {
    broadcastConversationUpdated(organizationId, conversationId, extra);
  }
}

export async function notifyConversationNewMessageById(
  organizationId: string,
  conversationId: string,
  messageId: string,
  extra?: { awaitingHumanHandoff?: boolean },
): Promise<void> {
  const payload = await loadMessageForWorkspaceWs(messageId);
  if (!payload) {
    broadcastConversationUpdated(organizationId, conversationId, extra);
    return;
  }
  notifyConversationNewMessage(organizationId, conversationId, payload, extra);
}
