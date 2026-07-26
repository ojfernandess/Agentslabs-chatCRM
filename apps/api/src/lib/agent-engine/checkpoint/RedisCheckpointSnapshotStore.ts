import type { GraphCheckpointSnapshot } from "./AgentCheckpointFactory.js";
import {
  agentEngineRedisKey,
  ensureAgentEngineRedisReady,
  getAgentEngineRedis,
} from "../redis/agentEngineRedis.js";

const SNAPSHOT_TTL_SEC = 60 * 60 * 24 * 7; // 7 dias

export async function writeCheckpointSnapshotToRedis(
  organizationId: string,
  snapshot: GraphCheckpointSnapshot,
): Promise<boolean> {
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return false;
  const key = agentEngineRedisKey("checkpoint", organizationId, snapshot.threadId);
  try {
    await redis.set(key, JSON.stringify(snapshot), "EX", SNAPSHOT_TTL_SEC);
    return true;
  } catch {
    return false;
  }
}

export async function readCheckpointSnapshotFromRedis(
  organizationId: string,
  threadId: string,
): Promise<GraphCheckpointSnapshot | null> {
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return null;
  const key = agentEngineRedisKey("checkpoint", organizationId, threadId);
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GraphCheckpointSnapshot;
    if (!parsed || typeof parsed !== "object" || parsed.threadId !== threadId) return null;
    return {
      threadId,
      next: Array.isArray(parsed.next) ? parsed.next : [],
      values:
        parsed.values && typeof parsed.values === "object"
          ? (parsed.values as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}
