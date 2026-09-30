import {
  mergeMessagesById,
  type MergeableConversation,
  type MergeableMessage,
} from "./mergeConversationMessages.js";
import { stripOptimisticOutboundMessages } from "./optimisticOutboundMessage.js";

export type ConversationMessageTailResponse = {
  messages: MergeableMessage[];
  newestCursor: string | null;
};

export function mergeIncrementalConversationSnapshot<T extends MergeableConversation>(input: {
  meta: T;
  prev: T | null;
  prevMessages: MergeableMessage[];
  tailMessages: MergeableMessage[];
  newestCursor: string | null;
}): T {
  let safePrevMessages =
    input.prev && input.prev.id === input.meta.id ? input.prevMessages : [];
  // `prevMessages` may be snapshotted before HTTP; `prev.messages` can include WS/realtime rows added during the fetch.
  if (input.prev && input.prev.id === input.meta.id && (input.prev.messages?.length ?? 0) > 0) {
    safePrevMessages = mergeMessagesById(safePrevMessages, input.prev.messages ?? []);
  }
  const existingIds = new Set(safePrevMessages.map((message) => message.id));
  const newMessages = input.tailMessages.filter((message) => !existingIds.has(message.id));
  if (newMessages.length > 0) {
    safePrevMessages = stripOptimisticOutboundMessages(safePrevMessages);
  }

  return {
    ...input.meta,
    messages: newMessages.length ? [...safePrevMessages, ...newMessages] : safePrevMessages,
    messagesHasMore: input.prev?.messagesHasMore ?? input.meta.messagesHasMore,
    messagesOlderCursor: input.prev?.messagesOlderCursor ?? input.meta.messagesOlderCursor,
    messagesNewerCursor: input.newestCursor ?? input.prev?.messagesNewerCursor ?? input.meta.messagesNewerCursor,
    messagesPaginationEnabled: input.prev?.messagesPaginationEnabled ?? input.meta.messagesPaginationEnabled,
  };
}
