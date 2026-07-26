import type { AgentGraphEvent } from "../types.js";
import {
  agentEngineRedisKey,
  ensureAgentEngineRedisReady,
  getAgentEngineRedis,
} from "../redis/agentEngineRedis.js";

type Subscriber = (event: AgentGraphEvent) => void;

const localSubscribers = new Map<string, Set<Subscriber>>();
const redisBridgeStarted = new Set<string>();

function eventChannel(threadId: string): string {
  return agentEngineRedisKey("events", threadId);
}

export function publishGraphEvent(threadId: string, event: AgentGraphEvent): void {
  const subs = localSubscribers.get(threadId);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(event);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
  void publishGraphEventToRedis(threadId, event);
}

async function publishGraphEventToRedis(threadId: string, event: AgentGraphEvent): Promise<void> {
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return;
  try {
    await redis.publish(eventChannel(threadId), JSON.stringify(event));
  } catch {
    /* ignore */
  }
}

export function subscribeGraphEvents(threadId: string, cb: Subscriber): () => void {
  let set = localSubscribers.get(threadId);
  if (!set) {
    set = new Set();
    localSubscribers.set(threadId, set);
  }
  set.add(cb);
  void ensureRedisBridgeForThread(threadId);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) localSubscribers.delete(threadId);
  };
}

async function ensureRedisBridgeForThread(threadId: string): Promise<void> {
  if (redisBridgeStarted.has(threadId)) return;
  const ok = await ensureAgentEngineRedisReady();
  const redis = getAgentEngineRedis();
  if (!ok || !redis) return;
  redisBridgeStarted.add(threadId);
  try {
    const sub = redis.duplicate();
    await sub.connect();
    await sub.subscribe(eventChannel(threadId));
    sub.on("message", (_channel, message) => {
      try {
        const event = JSON.parse(message) as AgentGraphEvent;
        const subs = localSubscribers.get(threadId);
        if (!subs) return;
        for (const cb of subs) {
          try {
            cb(event);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore malformed */
      }
    });
  } catch {
    redisBridgeStarted.delete(threadId);
  }
}

/** Apenas testes */
export function clearGraphEventBusForTests(): void {
  localSubscribers.clear();
  redisBridgeStarted.clear();
}
