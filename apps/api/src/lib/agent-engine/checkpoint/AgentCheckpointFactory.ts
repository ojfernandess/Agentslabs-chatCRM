import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import type { AgentCheckpointStoreKind } from "../types.js";
import { ensureAgentEngineRedisReady } from "../redis/agentEngineRedis.js";
import {
  readCheckpointSnapshotFromRedis,
  writeCheckpointSnapshotToRedis,
} from "./RedisCheckpointSnapshotStore.js";
import {
  getRedisStackCheckpointer,
  isRedisStackCheckpointAvailable,
} from "./RedisLangGraphCheckpointer.js";

const memoryRegistry = new Map<string, MemorySaver>();

export type AgentCheckpointMode = "memory" | "redis_native" | "redis_mirror_fallback";

/**
 * Modo efectivo do checkpoint quando o agente pede `redis`.
 * - `redis_native`: ShallowRedisSaver (resume cross-worker)
 * - `redis_mirror_fallback`: MemorySaver + mirror JSON plain Redis
 */
export function resolveAgentCheckpointMode(
  kind: AgentCheckpointStoreKind = "memory",
): AgentCheckpointMode {
  if (kind !== "redis") return "memory";
  return isRedisStackCheckpointAvailable() ? "redis_native" : "redis_mirror_fallback";
}

/**
 * Checkpointer LangGraph partilhado por scope (org) para MemorySaver;
 * ShallowRedisSaver é singleton process-wide quando Redis Stack disponível.
 */
export function getAgentGraphCheckpointer(
  kind: AgentCheckpointStoreKind = "memory",
  scopeKey = "default",
): BaseCheckpointSaver {
  if (kind === "redis") {
    const native = getRedisStackCheckpointer();
    if (native) return native;
    void ensureAgentEngineRedisReady();
  }
  const key = `${kind}:${scopeKey}`;
  if (!memoryRegistry.has(key)) {
    memoryRegistry.set(key, new MemorySaver());
  }
  return memoryRegistry.get(key)!;
}

/** @deprecated Use getAgentGraphCheckpointer */
export function createAgentGraphCheckpointer(
  kind: AgentCheckpointStoreKind = "memory",
  scopeKey = "default",
): BaseCheckpointSaver {
  return getAgentGraphCheckpointer(kind, scopeKey);
}

export function resolveCheckpointStoreKind(raw: unknown): AgentCheckpointStoreKind {
  return raw === "redis" ? "redis" : "memory";
}

export type GraphCheckpointSnapshot = {
  threadId: string;
  next: string[];
  values: Record<string, unknown>;
  storeKind?: AgentCheckpointStoreKind;
  checkpointMode?: AgentCheckpointMode;
  persistedAt?: string;
};

export async function readGraphCheckpointSnapshot(
  _checkpointer: BaseCheckpointSaver,
  compiledGraph: { getState: (config: { configurable: { thread_id: string } }) => Promise<unknown> },
  threadId: string,
): Promise<GraphCheckpointSnapshot | null> {
  try {
    const snap = (await compiledGraph.getState({
      configurable: { thread_id: threadId },
    })) as { next?: string[]; values?: Record<string, unknown> };
    return {
      threadId,
      next: Array.isArray(snap.next) ? snap.next : [],
      values: snap.values && typeof snap.values === "object" ? snap.values : {},
    };
  } catch {
    return null;
  }
}

export async function readGraphCheckpointSnapshotWithFallback(
  organizationId: string,
  storeKind: AgentCheckpointStoreKind,
  checkpointer: BaseCheckpointSaver,
  compiledGraph: { getState: (config: { configurable: { thread_id: string } }) => Promise<unknown> },
  threadId: string,
): Promise<GraphCheckpointSnapshot | null> {
  const mode = resolveAgentCheckpointMode(storeKind);
  if (mode === "redis_native") {
    const snap = await readGraphCheckpointSnapshot(checkpointer, compiledGraph, threadId);
    return snap ? { ...snap, checkpointMode: mode } : null;
  }
  if (storeKind === "redis") {
    const fromRedis = await readCheckpointSnapshotFromRedis(organizationId, threadId);
    if (fromRedis) return { ...fromRedis, checkpointMode: "redis_mirror_fallback" };
  }
  const snap = await readGraphCheckpointSnapshot(checkpointer, compiledGraph, threadId);
  return snap ? { ...snap, checkpointMode: mode } : null;
}

export async function persistGraphCheckpointSnapshot(
  organizationId: string,
  storeKind: AgentCheckpointStoreKind,
  snapshot: GraphCheckpointSnapshot,
): Promise<void> {
  if (storeKind !== "redis") return;
  if (resolveAgentCheckpointMode(storeKind) === "redis_native") return;
  await writeCheckpointSnapshotToRedis(organizationId, {
    ...snapshot,
    storeKind,
    checkpointMode: "redis_mirror_fallback",
    persistedAt: new Date().toISOString(),
  });
}

/** Apenas testes — limpa registry in-memory. */
export function clearAgentGraphCheckpointersForTests(): void {
  memoryRegistry.clear();
}

export { isRedisStackCheckpointAvailable };
