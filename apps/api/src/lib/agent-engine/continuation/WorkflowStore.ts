import {
  agentEngineRedisKey,
  ensureAgentEngineRedisReady,
  getAgentEngineRedis,
} from "../redis/agentEngineRedis.js";
import type { WorkflowRunState } from "./types.js";

const memoryByRunId = new Map<string, WorkflowRunState>();
const WORKFLOW_TTL_SEC = 60 * 60 * 24 * 7; // 7 dias

function workflowKey(organizationId: string, runId: string): string {
  return agentEngineRedisKey("workflow", organizationId, runId);
}

function conversationIndexKey(organizationId: string, conversationId: string): string {
  return agentEngineRedisKey("workflow", organizationId, "conv", conversationId);
}

/** Persistência durável do run (memória + Redis quando disponível). */
export async function saveWorkflowRun(state: WorkflowRunState): Promise<void> {
  memoryByRunId.set(state.runId, state);
  const org = state.organizationId;
  if (!org) return;
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return;
  try {
    await redis.set(workflowKey(org, state.runId), JSON.stringify(state), "EX", WORKFLOW_TTL_SEC);
    if (state.conversationId) {
      await redis.set(
        conversationIndexKey(org, state.conversationId),
        state.runId,
        "EX",
        WORKFLOW_TTL_SEC,
      );
    }
  } catch {
    /* in-memory only */
  }
}

export async function loadWorkflowRun(
  runId: string,
  organizationId?: string,
): Promise<WorkflowRunState | null> {
  const mem = memoryByRunId.get(runId);
  if (mem) return mem;
  if (!organizationId) return null;
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return null;
  try {
    const raw = await redis.get(workflowKey(organizationId, runId));
    if (!raw) return null;
    const state = JSON.parse(raw) as WorkflowRunState;
    memoryByRunId.set(runId, state);
    return state;
  } catch {
    return null;
  }
}

export async function loadActiveWorkflowForConversation(
  organizationId: string,
  conversationId: string,
): Promise<WorkflowRunState | null> {
  for (const s of memoryByRunId.values()) {
    if (
      s.organizationId === organizationId &&
      s.conversationId === conversationId &&
      (s.status === "suspended" || s.status === "running")
    ) {
      return s;
    }
  }
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return null;
  try {
    const runId = await redis.get(conversationIndexKey(organizationId, conversationId));
    if (!runId) return null;
    return loadWorkflowRun(runId, organizationId);
  } catch {
    return null;
  }
}

/** Test helper — limpa store in-memory. */
export function clearWorkflowStoreForTests(): void {
  memoryByRunId.clear();
}
