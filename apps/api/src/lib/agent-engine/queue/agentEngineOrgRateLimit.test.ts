import assert from "node:assert/strict";
import { test } from "node:test";
import IORedis from "ioredis";
import { acquireAgentEngineOrgSlot } from "./agentEngineOrgRateLimit.js";

const redisUrl = process.env.REDIS_URL?.trim();

test("acquireAgentEngineOrgSlot disabled when max is 0", async () => {
  const fake = {} as IORedis;
  const result = await acquireAgentEngineOrgSlot(fake, "org-1", 0, 60_000);
  assert.equal(result.acquired, true);
  assert.equal(result.retryAfterMs, 0);
});

test(
  "acquireAgentEngineOrgSlot enforces per-org window",
  { skip: !redisUrl },
  async () => {
    const redis = new IORedis(redisUrl!, { maxRetriesPerRequest: 1 });
    const orgId = `test-org-${Date.now()}`;
    const key = `agent-engine:org-rl:${orgId}`;
    await redis.del(key);

    const first = await acquireAgentEngineOrgSlot(redis, orgId, 2, 60_000);
    const second = await acquireAgentEngineOrgSlot(redis, orgId, 2, 60_000);
    const third = await acquireAgentEngineOrgSlot(redis, orgId, 2, 60_000);

    assert.equal(first.acquired, true);
    assert.equal(second.acquired, true);
    assert.equal(third.acquired, false);
    assert.ok(third.retryAfterMs >= 500);

    await redis.del(key);
    await redis.quit();
  },
);
