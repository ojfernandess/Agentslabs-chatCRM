import { isOptimisticOutboundMessageId } from "./optimisticOutboundMessage.js";

export type MergeableMessage = {
  id: string;
  sentAt: string;
  createdAt: string;
  status: string;
  direction?: string;
  body?: string | null;
};

const OPTIMISTIC_OUTBOUND_CONFIRM_SLACK_MS = 15_000;
const OPTIMISTIC_OUTBOUND_CONFIRM_MAX_FUTURE_MS = 120_000;

export function normalizeOutboundBody(body: string | null | undefined): string {
  return (body ?? "").replace(/\r\n/g, "\n").trim();
}

/** True when a persisted outbound row is the server copy of a specific optimistic send (not any other outbound). */
export function persistedOutboundReplacesOptimistic<T extends MergeableMessage>(
  optimistic: T,
  persisted: T,
): boolean {
  if (!isOptimisticOutboundMessageId(optimistic.id)) return false;
  if (isOptimisticOutboundMessageId(persisted.id)) return false;
  if (persisted.direction === "INBOUND") return false;

  const optBody = normalizeOutboundBody(optimistic.body);
  const perBody = normalizeOutboundBody(persisted.body);
  if (optBody && perBody) {
    return optBody === perBody;
  }

  if (persisted.direction !== "OUTBOUND") return false;
  const optTs = messageTimestampMs(optimistic);
  const perTs = messageTimestampMs(persisted);
  return (
    perTs >= optTs - OPTIMISTIC_OUTBOUND_CONFIRM_SLACK_MS &&
    perTs <= optTs + OPTIMISTIC_OUTBOUND_CONFIRM_MAX_FUTURE_MS
  );
}

/** Swap matching optimistic rows for persisted outbound in-place; leave unrelated optimistics untouched. */
export function applyPersistedOutboundConfirmations<T extends MergeableMessage>(
  localMessages: T[],
  incomingMessages: T[],
): T[] {
  let result = localMessages;
  for (const incoming of incomingMessages) {
    if (incoming.direction === "INBOUND") continue;
    const index = result.findIndex(
      (message) =>
        isOptimisticOutboundMessageId(message.id) &&
        persistedOutboundReplacesOptimistic(message, incoming),
    );
    if (index < 0) continue;
    const next = [...result];
    next[index] = incoming;
    result = next;
  }
  return result;
}

/** Drop optimistic rows when the persisted outbound for the same send is already in the list. */
export function pruneRedundantOptimisticMessages<T extends MergeableMessage>(messages: T[]): T[] {
  const persistedOutbound = messages.filter(
    (message) => !isOptimisticOutboundMessageId(message.id) && message.direction !== "INBOUND",
  );
  if (!messages.some((message) => isOptimisticOutboundMessageId(message.id))) {
    return messages;
  }
  return messages.filter((message) => {
    if (!isOptimisticOutboundMessageId(message.id)) return true;
    return !persistedOutbound.some((persisted) =>
      persistedOutboundReplacesOptimistic(message, persisted),
    );
  });
}

/** Last occurrence wins (e.g. realtime patch after stale row). */
export function dedupeMessagesByIdPreservingOrder<T extends { id: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    out.unshift(message);
  }
  return out;
}

export function finalizeConversationMessages<T extends MergeableMessage>(messages: T[]): T[] {
  return pruneRedundantOptimisticMessages(dedupeMessagesByIdPreservingOrder(messages));
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
    const localMessage = byId.get(message.id);
    if (!localMessage) {
      byId.set(message.id, message);
      continue;
    }
    const merged = { ...localMessage, ...message };
    const remoteBody = (message.body ?? "").trim();
    const localBody = (localMessage.body ?? "").trim();
    if (!remoteBody && localBody) {
      merged.body = localMessage.body;
    }
    const remoteMedia = (message as { mediaUrl?: string | null }).mediaUrl ?? "";
    const localMedia = (localMessage as { mediaUrl?: string | null }).mediaUrl ?? "";
    if (!remoteMedia && localMedia) {
      (merged as { mediaUrl?: string | null }).mediaUrl = (
        localMessage as { mediaUrl?: string | null }
      ).mediaUrl;
    }
    byId.set(message.id, merged);
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
  const mergeLocal = applyPersistedOutboundConfirmations(localMessages, newInRemote);
  const mergedMessages = finalizeConversationMessages(mergeMessagesById(mergeLocal, remoteMessages));
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
