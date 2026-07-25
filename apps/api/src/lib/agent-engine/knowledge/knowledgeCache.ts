import type { KnowledgeQueryResult } from "./knowledgeEngineTypes.js";

const queryCache = new Map<string, { expiresAt: number; value: KnowledgeQueryResult }>();
const embeddingCache = new Map<string, { expiresAt: number; value: number[] }>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

function cacheKey(prefix: string, parts: Record<string, unknown>): string {
  return `${prefix}:${JSON.stringify(parts)}`;
}

function prune(map: Map<string, { expiresAt: number }>): void {
  if (map.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.expiresAt <= now) map.delete(k);
  }
  if (map.size > MAX_ENTRIES) {
    const keys = [...map.keys()].slice(0, map.size - MAX_ENTRIES);
    for (const k of keys) map.delete(k);
  }
}

export function getCachedQuery(key: string): KnowledgeQueryResult | null {
  const row = queryCache.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return { ...row.value, fromCache: true };
}

export function setCachedQuery(key: string, value: KnowledgeQueryResult, ttlMs = DEFAULT_TTL_MS): void {
  queryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  prune(queryCache);
}

export function getCachedEmbedding(key: string): number[] | null {
  const row = embeddingCache.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    embeddingCache.delete(key);
    return null;
  }
  return row.value;
}

export function setCachedEmbedding(key: string, value: number[], ttlMs = DEFAULT_TTL_MS): void {
  embeddingCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  prune(embeddingCache);
}

export function buildKnowledgeQueryCacheKey(input: {
  organizationId: string;
  botId?: string;
  provider: string;
  query: string;
  maxChunks: number;
}): string {
  return cacheKey("kb_query", input);
}

export function clearKnowledgeCache(scope?: { organizationId?: string }): number {
  let removed = 0;
  if (!scope?.organizationId) {
    removed = queryCache.size + embeddingCache.size;
    queryCache.clear();
    embeddingCache.clear();
    return removed;
  }
  for (const key of [...queryCache.keys()]) {
    if (key.includes(scope.organizationId)) {
      queryCache.delete(key);
      removed += 1;
    }
  }
  for (const key of [...embeddingCache.keys()]) {
    if (key.includes(scope.organizationId)) {
      embeddingCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function getKnowledgeCacheStats(): { queryEntries: number; embeddingEntries: number } {
  return { queryEntries: queryCache.size, embeddingEntries: embeddingCache.size };
}
