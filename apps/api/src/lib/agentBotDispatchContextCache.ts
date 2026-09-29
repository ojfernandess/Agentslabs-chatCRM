import type { AgentBotDispatchContext } from "./agentBotTriage.js";
import { config } from "../config.js";

type CacheEntry = {
  expiresAt: number;
  value: AgentBotDispatchContext | null;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(organizationId: string, inboxId: string): string {
  return `${organizationId}:${inboxId}`;
}

function ttlMs(): number {
  return config.agentBotDispatchContextCacheTtlMs;
}

export function getCachedAgentBotDispatchContext(
  organizationId: string,
  inboxId: string,
): AgentBotDispatchContext | null | undefined {
  const entry = cache.get(cacheKey(organizationId, inboxId));
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey(organizationId, inboxId));
    return undefined;
  }
  return entry.value;
}

export function setCachedAgentBotDispatchContext(
  organizationId: string,
  inboxId: string,
  value: AgentBotDispatchContext | null,
): void {
  cache.set(cacheKey(organizationId, inboxId), {
    value,
    expiresAt: Date.now() + ttlMs(),
  });
}

export function invalidateAgentBotDispatchContextCache(
  organizationId: string,
  inboxId?: string,
): void {
  if (inboxId) {
    cache.delete(cacheKey(organizationId, inboxId));
    return;
  }
  const prefix = `${organizationId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function resetAgentBotDispatchContextCacheForTests(): void {
  cache.clear();
}
