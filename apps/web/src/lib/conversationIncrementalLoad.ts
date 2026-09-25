import type { MergeableConversation, MergeableMessage } from "./mergeConversationMessages.js";

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
  const existingIds = new Set(input.prevMessages.map((message) => message.id));
  const newMessages = input.tailMessages.filter((message) => !existingIds.has(message.id));

  return {
    ...input.meta,
    messages: newMessages.length ? [...input.prevMessages, ...newMessages] : input.prevMessages,
    messagesHasMore: input.prev?.messagesHasMore ?? input.meta.messagesHasMore,
    messagesOlderCursor: input.prev?.messagesOlderCursor ?? input.meta.messagesOlderCursor,
    messagesNewerCursor: input.newestCursor ?? input.prev?.messagesNewerCursor ?? input.meta.messagesNewerCursor,
    messagesPaginationEnabled: input.prev?.messagesPaginationEnabled ?? input.meta.messagesPaginationEnabled,
  };
}
