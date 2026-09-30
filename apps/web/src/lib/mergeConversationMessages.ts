import {
  isOptimisticOutboundMessageId,
  stripOptimisticOutboundMessages,
} from "./optimisticOutboundMessage.js";

export type MergeableMessage = {
  id: string;
  sentAt: string;
  createdAt: string;
  status: string;
  direction?: string;
};

const OPTIMISTIC_OUTBOUND_CONFIRM_SLACK_MS = 15_000;

/** True when newly arrived rows include a persisted outbound that likely replaces a pending optimistic send. */
export function incomingMessagesConfirmOptimisticOutbound<T extends MergeableMessage>(
  localMessages: T[],
  incomingMessages: T[],
): boolean {
  const optimistic = localMessages.filter((m) => isOptimisticOutboundMessageId(m.id));
  if (!optimistic.length || !incomingMessages.length) return false;

  const optimisticMaxTs = maxMessageTimestampMs(optimistic);
  const minConfirmTs = optimisticMaxTs - OPTIMISTIC_OUTBOUND_CONFIRM_SLACK_MS;

  return incomingMessages.some((message) => {
    if (isOptimisticOutboundMessageId(message.id)) return false;
    if (localMessages.some((local) => local.id === message.id)) return false;
    if (message.direction === "INBOUND") return false;
    if (message.direction === "OUTBOUND") {
      return messageTimestampMs(message) >= minConfirmTs;
    }
    return false;
  });
}

export function messageTimestampMs(message: Pick<MergeableMessage, "sentAt" | "createdAt">): number {
  const sent = Date.parse(message.sentAt);
  if (Number.isFinite(sent)) return sent;
  const created = Date.parse(message.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function maxMessageTimestampMs(messages: Array<Pick<MergeableMessage, "sentAt" | "createdAt">>): number {
  let max = 0;
  for (const message of messages) {
    max = Math.max(max, messageTimestampMs(message));
  }
  return max;
}

/** Merge by id; remote rows win field conflicts. Preserves local-only messages (e.g. WS ahead of HTTP). */
export function mergeMessagesById<T extends MergeableMessage>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const message of local) {
    byId.set(message.id, message);
  }
  for (const message of remote) {
    byId.set(message.id, message);
  }
  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const delta = messageTimestampMs(a) - messageTimestampMs(b);
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });
  return merged;
}

export function localMessagesMissingFromRemote<T extends MergeableMessage>(local: T[], remote: T[]): T[] {
  if (!local.length) return [];
  const remoteIds = new Set(remote.map((message) => message.id));
  return local.filter((message) => !remoteIds.has(message.id));
}

/** True when HTTP returned an older window while local state already has newer rows. */
export function isRemoteMessagesSnapshotStale<T extends MergeableMessage>(local: T[], remote: T[]): boolean {
  const localOnly = localMessagesMissingFromRemote(local, remote);
  if (!localOnly.length) return false;
  return maxMessageTimestampMs(local) > maxMessageTimestampMs(remote);
}

export type MergeableConversation = {
  id: string;
  messages?: MergeableMessage[];
  messagesHasMore?: boolean;
  messagesOlderCursor?: string | null;
  messagesNewerCursor?: string | null;
  messagesPaginationEnabled?: boolean;
};

/** Apply an HTTP snapshot without dropping messages already present locally. */
export function mergeConversationWithRemote<T extends MergeableConversation>(local: T | null, remote: T): T {
  if (!local || local.id !== remote.id) {
    return remote;
  }

  const localMessages = local.messages ?? [];
  const remoteMessages = remote.messages ?? [];
  const newInRemote = remoteMessages.filter(
    (message) => !localMessages.some((localMessage) => localMessage.id === message.id),
  );
  const mergeLocal = incomingMessagesConfirmOptimisticOutbound(localMessages, newInRemote)
    ? stripOptimisticOutboundMessages(localMessages)
    : localMessages;
  const mergedMessages = mergeMessagesById(mergeLocal, remoteMessages);
  const preservedLocalOnly = localMessagesMissingFromRemote(mergeLocal, remoteMessages).length > 0;

  return {
    ...remote,
    messages: mergedMessages,
    messagesHasMore: remote.messagesHasMore ?? local.messagesHasMore,
    messagesOlderCursor: preservedLocalOnly
      ? local.messagesOlderCursor ?? remote.messagesOlderCursor
      : remote.messagesOlderCursor ?? local.messagesOlderCursor,
    messagesNewerCursor: remote.messagesNewerCursor ?? local.messagesNewerCursor,
    messagesPaginationEnabled: remote.messagesPaginationEnabled ?? local.messagesPaginationEnabled,
  };
}
