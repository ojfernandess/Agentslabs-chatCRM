import IORedis from "ioredis";

const KEY_PREFIX = "openconduit:agent";

let connection: IORedis | null = null;
let redisOperational = false;
let redisInitAttempted = false;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isAgentEngineRedisAvailable(): boolean {
  return redisOperational;
}

export function agentEngineRedisKey(...parts: string[]): string {
  return [KEY_PREFIX, ...parts].join(":");
}

/** Lazy singleton — partilhado por HITL, checkpoint mirror e event bus. */
export function getAgentEngineRedis(): IORedis | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!connection) {
    connection = new IORedis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 8_000,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 400, 2000)),
    });
    connection.on("error", () => {
      redisOperational = false;
    });
  }
  return connection;
}

/** Ping Redis uma vez por processo; fallback gracioso se indisponível. */
export async function ensureAgentEngineRedisReady(): Promise<boolean> {
  if (redisInitAttempted && !redisOperational) return false;
  const redis = getAgentEngineRedis();
  if (!redis) {
    redisInitAttempted = true;
    redisOperational = false;
    return false;
  }
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.ping();
    redisOperational = true;
    redisInitAttempted = true;
    return true;
  } catch {
    redisOperational = false;
    redisInitAttempted = true;
    return false;
  }
}

/** Apenas testes — fecha ligação e repõe flags. */
export async function resetAgentEngineRedisForTests(): Promise<void> {
  redisInitAttempted = false;
  redisOperational = false;
  if (connection) {
    try {
      connection.disconnect();
    } catch {
      /* ignore */
    }
    connection = null;
  }
}
