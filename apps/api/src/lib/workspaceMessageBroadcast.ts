import type { MessageDirection, MessageStatus, MessageType } from "@prisma/client";
import { prisma } from "../db.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
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

export function serializeMessageForWorkspaceWs(message: MessageLike): WorkspaceMessagePayload {
  const sentAt = message.sentAt ?? message.createdAt;
  return {
    id: message.id,
    direction: message.direction,
    type: message.type,
    body: message.body,
    mediaUrl: message.mediaUrl ?? null,
    mediaType: message.mediaType ?? null,
    isPrivate: message.isPrivate ?? false,
    status: message.status,
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
  };
}

export async function loadMessageForWorkspaceWs(messageId: string): Promise<WorkspaceMessagePayload | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    include: { actorUser: { select: actorUserSelect } },
  });
  return row ? serializeMessageForWorkspaceWs(row) : null;
}

export function broadcastConversationMessageCreated(
  organizationId: string,
  conversationId: string,
  message: WorkspaceMessagePayload,
): void {
  broadcastToOrganization(organizationId, {
    type: "message.created",
    conversationId,
    message,
  });
}

export function broadcastConversationMessageUpdated(
  organizationId: string,
  conversationId: string,
  message: Pick<WorkspaceMessagePayload, "id" | "status">,
): void {
  broadcastToOrganization(organizationId, {
    type: "message.updated",
    conversationId,
    message,
  });
}

/** Push da mensagem nova + sinal de conversa actualizada (lista lateral / metadados). */
export function notifyConversationNewMessage(
  organizationId: string,
  conversationId: string,
  message: WorkspaceMessagePayload,
  extra?: { awaitingHumanHandoff?: boolean },
): void {
  broadcastConversationMessageCreated(organizationId, conversationId, message);
  broadcastConversationUpdated(organizationId, conversationId, extra);
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
