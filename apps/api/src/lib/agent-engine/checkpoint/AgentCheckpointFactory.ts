import { MemorySaver } from "@langchain/langgraph";
import type { AgentCheckpointStoreKind } from "../types.js";
import { ensureAgentEngineRedisReady } from "../redis/agentEngineRedis.js";
import {
  readCheckpointSnapshotFromRedis,
  writeCheckpointSnapshotToRedis,
} from "./RedisCheckpointSnapshotStore.js";

const checkpointerRegistry = new Map<string, MemorySaver>();

/**
 * Checkpointer partilhado por scope (org).
 * `redis`: MemorySaver in-process + mirror de snapshots JSON em Redis (plain Redis, sem RedisJSON).
 */
export function getAgentGraphCheckpointer(
  kind: AgentCheckpointStoreKind = "memory",
  scopeKey = "default",
): MemorySaver {
  if (kind === "redis") {
    void ensureAgentEngineRedisReady();
  }
  const key = `${kind}:${scopeKey}`;
  if (!checkpointerRegistry.has(key)) {
    checkpointerRegistry.set(key, new MemorySaver());
  }
  return checkpointerRegistry.get(key)!;
}

/** @deprecated Use getAgentGraphCheckpointer */
export function createAgentGraphCheckpointer(
  kind: AgentCheckpointStoreKind = "memory",
  scopeKey = "default",
): MemorySaver {
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
  persistedAt?: string;
};

export async function readGraphCheckpointSnapshot(
  checkpointer: MemorySaver,
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
  checkpointer: MemorySaver,
  compiledGraph: { getState: (config: { configurable: { thread_id: string } }) => Promise<unknown> },
  threadId: string,
): Promise<GraphCheckpointSnapshot | null> {
  if (storeKind === "redis") {
    const fromRedis = await readCheckpointSnapshotFromRedis(organizationId, threadId);
    if (fromRedis) return fromRedis;
  }
  return readGraphCheckpointSnapshot(checkpointer, compiledGraph, threadId);
}

export async function persistGraphCheckpointSnapshot(
  organizationId: string,
  storeKind: AgentCheckpointStoreKind,
  snapshot: GraphCheckpointSnapshot,
): Promise<void> {
  if (storeKind !== "redis") return;
  await writeCheckpointSnapshotToRedis(organizationId, {
    ...snapshot,
    storeKind,
    persistedAt: new Date().toISOString(),
  });
}

/** Apenas testes — limpa registry in-memory. */
export function clearAgentGraphCheckpointersForTests(): void {
  checkpointerRegistry.clear();
}
