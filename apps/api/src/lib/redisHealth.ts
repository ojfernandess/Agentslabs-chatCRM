import Redis from "ioredis";
import { config } from "../config.js";

export type RedisHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export async function getRedisHealth(): Promise<RedisHealth> {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    lazyConnect: true,
  });
  const start = Date.now();
  try {
    await redis.connect();
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "redis_error",
    };
  } finally {
    redis.disconnect();
  }
}
