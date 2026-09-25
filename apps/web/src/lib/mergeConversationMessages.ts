export type MergeableMessage = {
  id: string;
  sentAt: string;
  createdAt: string;
  status: string;
};

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
  const mergedMessages = mergeMessagesById(localMessages, remoteMessages);
  const preservedLocalOnly = localMessagesMissingFromRemote(localMessages, remoteMessages).length > 0;

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
