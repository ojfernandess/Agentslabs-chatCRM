export type ConversationMessagePushPayload = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isPrivate?: boolean;
  status: string;
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

export const CONVERSATION_MESSAGE_CREATED_EVENT = "openconduit:conversation-message-created";
export const CONVERSATION_MESSAGE_UPDATED_EVENT = "openconduit:conversation-message-updated";

export type ConversationMessageCreatedDetail = {
  conversationId: string;
  message: ConversationMessagePushPayload;
};

export type ConversationMessageUpdatedDetail = {
  conversationId: string;
  message: Pick<ConversationMessagePushPayload, "id" | "status">;
};

export function publishConversationMessageCreated(detail: ConversationMessageCreatedDetail): void {
  window.dispatchEvent(new CustomEvent(CONVERSATION_MESSAGE_CREATED_EVENT, { detail }));
}

export function publishConversationMessageUpdated(detail: ConversationMessageUpdatedDetail): void {
  window.dispatchEvent(new CustomEvent(CONVERSATION_MESSAGE_UPDATED_EVENT, { detail }));
}
