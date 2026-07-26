import { randomUUID } from "node:crypto";
import type { AgentCheckpointStoreKind } from "../types.js";
import {
  agentEngineRedisKey,
  ensureAgentEngineRedisReady,
  getAgentEngineRedis,
} from "../redis/agentEngineRedis.js";

export type HitlPendingApproval = {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string;
  botId: string;
  replyPreview: string;
  supervisorSummary: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
  /** Thread LangGraph para resume (`conversationId:messageId`). */
  threadId?: string;
  checkpointStore?: AgentCheckpointStoreKind;
  /** Quando true, grafo usa `interrupt()` nativo. */
  humanInTheLoopNative?: boolean;
  deliveredMessageId?: string;
};

const pendingById = new Map<string, HitlPendingApproval>();
const HITL_TTL_SEC = 60 * 60 * 24 * 14; // 14 dias

function hitlKey(organizationId: string, id: string): string {
  return agentEngineRedisKey("hitl", organizationId, id);
}

function hitlIndexKey(organizationId: string): string {
  return agentEngineRedisKey("hitl", organizationId, "index");
}

async function persistHitlToRedis(row: HitlPendingApproval): Promise<void> {
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return;
  try {
    await redis.set(hitlKey(row.organizationId, row.id), JSON.stringify(row), "EX", HITL_TTL_SEC);
    if (row.status === "pending") {
      await redis.sadd(hitlIndexKey(row.organizationId), row.id);
    } else {
      await redis.srem(hitlIndexKey(row.organizationId), row.id);
    }
  } catch {
    /* fallback in-memory only */
  }
}

async function loadHitlFromRedis(organizationId: string, id: string): Promise<HitlPendingApproval | null> {
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return null;
  try {
    const raw = await redis.get(hitlKey(organizationId, id));
    if (!raw) return null;
    return JSON.parse(raw) as HitlPendingApproval;
  } catch {
    return null;
  }
}

/** Regista resposta pendente de aprovação humana (memória + Redis quando disponível). */
export function registerHitlPending(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  botId: string;
  replyPreview: string;
  supervisorSummary: string;
  threadId?: string;
  checkpointStore?: AgentCheckpointStoreKind;
  humanInTheLoopNative?: boolean;
}): HitlPendingApproval {
  const row: HitlPendingApproval = {
    id: randomUUID(),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    botId: input.botId,
    replyPreview: input.replyPreview.slice(0, 4000),
    supervisorSummary: input.supervisorSummary.slice(0, 1000),
    status: "pending",
    createdAt: new Date().toISOString(),
    threadId: input.threadId,
    checkpointStore: input.checkpointStore,
    humanInTheLoopNative: input.humanInTheLoopNative,
  };
  pendingById.set(row.id, row);
  void persistHitlToRedis(row);
  return row;
}

export function getHitlPending(id: string): HitlPendingApproval | null {
  return pendingById.get(id) ?? null;
}

export async function getHitlPendingAsync(
  id: string,
  organizationId: string,
): Promise<HitlPendingApproval | null> {
  const local = pendingById.get(id);
  if (local) return local;
  const remote = await loadHitlFromRedis(organizationId, id);
  if (remote) pendingById.set(remote.id, remote);
  return remote;
}

export function listHitlPending(organizationId: string, conversationId?: string): HitlPendingApproval[] {
  return [...pendingById.values()].filter(
    (p) =>
      p.organizationId === organizationId &&
      p.status === "pending" &&
      (!conversationId || p.conversationId === conversationId),
  );
}

export async function listHitlPendingAsync(
  organizationId: string,
  conversationId?: string,
): Promise<HitlPendingApproval[]> {
  const local = listHitlPending(organizationId, conversationId);
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return local;

  try {
    const ids = await redis.smembers(hitlIndexKey(organizationId));
    const merged = new Map(local.map((r) => [r.id, r]));
    for (const id of ids) {
      if (merged.has(id)) continue;
      const row = await loadHitlFromRedis(organizationId, id);
      if (row && row.status === "pending") {
        if (!conversationId || row.conversationId === conversationId) {
          pendingById.set(row.id, row);
          merged.set(row.id, row);
        }
      }
    }
    return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return local;
  }
}

export function resolveHitlPending(
  id: string,
  organizationId: string,
  decision: "approved" | "rejected",
): HitlPendingApproval | null {
  const row = pendingById.get(id);
  if (!row || row.organizationId !== organizationId || row.status !== "pending") return null;
  row.status = decision;
  row.resolvedAt = new Date().toISOString();
  pendingById.set(id, row);
  void persistHitlToRedis(row);
  return row;
}

/** Apenas testes — limpa store in-memory. */
export function clearHitlPendingForTests(): void {
  pendingById.clear();
}
