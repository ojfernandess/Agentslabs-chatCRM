import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ShallowRedisSaver } from "@langchain/langgraph-checkpoint-redis/shallow";
import type { FastifyBaseLogger } from "fastify";

/** TTL em minutos — 7 dias (ShallowRedisSaver defaultTTL). */
const CHECKPOINT_TTL_MINUTES = 60 * 24 * 7;

let redisStackSaver: ShallowRedisSaver | null = null;
let redisStackOperational = false;
let initAttempted = false;

export function isRedisStackCheckpointAvailable(): boolean {
  return redisStackOperational;
}

/**
 * Inicializa ShallowRedisSaver (RedisJSON + RediSearch — Redis Stack ou Redis 8+).
 * Falha graciosamente se módulos não existirem — factory usa MemorySaver + mirror JSON.
 */
export async function initRedisLangGraphCheckpointer(log?: FastifyBaseLogger): Promise<boolean> {
  if (initAttempted && !redisStackOperational) return false;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    initAttempted = true;
    return false;
  }
  try {
    const saver = await ShallowRedisSaver.fromUrl(url, {
      defaultTTL: CHECKPOINT_TTL_MINUTES,
      refreshOnRead: true,
    });
    redisStackSaver = saver;
    redisStackOperational = true;
    initAttempted = true;
    log?.info("LangGraph ShallowRedisSaver ready (resume cross-worker)");
    return true;
  } catch (err) {
    initAttempted = true;
    redisStackOperational = false;
    redisStackSaver = null;
    log?.warn(
      { err: err instanceof Error ? err.message : err },
      "Redis Stack checkpointer unavailable — fallback MemorySaver + JSON mirror",
    );
    return false;
  }
}

export function getRedisStackCheckpointer(): BaseCheckpointSaver | null {
  return redisStackOperational && redisStackSaver ? redisStackSaver : null;
}

export async function closeRedisLangGraphCheckpointer(): Promise<void> {
  if (redisStackSaver) {
    await redisStackSaver.end().catch(() => {});
    redisStackSaver = null;
  }
  redisStackOperational = false;
  initAttempted = false;
}

/** Apenas testes — repõe estado do singleton. */
export async function resetRedisLangGraphCheckpointerForTests(): Promise<void> {
  await closeRedisLangGraphCheckpointer();
}
