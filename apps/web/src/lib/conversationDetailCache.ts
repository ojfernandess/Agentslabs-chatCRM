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
