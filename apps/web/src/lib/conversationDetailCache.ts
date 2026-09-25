import { mergeMessagesById, type MergeableMessage } from "./mergeConversationMessages.js";

type CachedConversation = {
  data: unknown;
  fetchedAt: number;
};

const cache = new Map<string, CachedConversation>();
const inflight = new Map<string, Promise<unknown>>();

const MAX_ENTRIES = 40;
const TTL_MS = 5 * 60 * 1000;

export function getCachedConversation<T>(id: string): T | null {
  const row = cache.get(id);
  if (!row) return null;
  if (Date.now() - row.fetchedAt > TTL_MS) {
    cache.delete(id);
    return null;
  }
  return row.data as T;
}

export function setCachedConversation<T>(id: string, data: T): void {
  cache.set(id, { data, fetchedAt: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

type CachedConversationWithMessages = {
  messages?: MergeableMessage[];
};

/** Avoid poisoning cache with an HTTP snapshot that drops newer local/realtime messages. */
export function setCachedConversationMerged<T extends CachedConversationWithMessages>(
  id: string,
  data: T,
  previous?: T | null,
): void {
  const prevMessages = previous?.messages ?? [];
  const nextMessages = data.messages ?? [];
  if (prevMessages.length > 0 && nextMessages.length > 0) {
    const mergedMessages = mergeMessagesById(prevMessages, nextMessages);
    if (mergedMessages.length > nextMessages.length) {
      setCachedConversation(id, { ...data, messages: mergedMessages });
      return;
    }
  }
  setCachedConversation(id, data);
}

export function getInflightConversation<T>(id: string): Promise<T> | null {
  const pending = inflight.get(id);
  return pending ? (pending as Promise<T>) : null;
}

export function setInflightConversation<T>(id: string, promise: Promise<T>): Promise<T> {
  inflight.set(id, promise);
  void promise.finally(() => {
    if (inflight.get(id) === promise) inflight.delete(id);
  });
  return promise;
}

export function invalidateCachedConversation(id: string): void {
  cache.delete(id);
  inflight.delete(id);
}

export function clearInflightConversation(id: string): void {
  inflight.delete(id);
}
