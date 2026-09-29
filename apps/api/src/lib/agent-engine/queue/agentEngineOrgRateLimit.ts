import type IORedis from "ioredis";

export type AgentEngineOrgRateLimitResult = {
  acquired: boolean;
  retryAfterMs: number;
};

/**
 * Sliding window simples por organização (Redis INCR + PEXPIRE).
 * `max <= 0` desactiva o limite.
 */
export async function acquireAgentEngineOrgSlot(
  connection: IORedis,
  organizationId: string,
  max: number,
  windowMs: number,
): Promise<AgentEngineOrgRateLimitResult> {
  if (max <= 0 || windowMs <= 0) {
    return { acquired: true, retryAfterMs: 0 };
  }
  const key = `agent-engine:org-rl:${organizationId}`;
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.pexpire(key, windowMs);
  }
  if (count > max) {
    const ttl = await connection.pttl(key);
    return { acquired: false, retryAfterMs: Math.max(500, ttl > 0 ? ttl : windowMs) };
  }
  return { acquired: true, retryAfterMs: 0 };
}
