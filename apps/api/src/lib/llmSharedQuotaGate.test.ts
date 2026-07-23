import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetLlmQuotaGatesForTests,
  acquireLlmQuotaSlot,
  configureLlmQuotaGateDefaults,
  getLlmQuotaGateStats,
  llmQuotaGateKey,
  markLlmQuotaCooldown,
  withConversationAgentReplyLock,
  withLlmQuotaSlot,
} from "./llmSharedQuotaGate.js";

test.beforeEach(() => {
  __resetLlmQuotaGatesForTests();
  configureLlmQuotaGateDefaults({ maxConcurrent: 2, maxQueueWaitMs: 5_000 });
});

test("llmQuotaGateKey fingerprints without exposing secret", () => {
  const a = llmQuotaGateKey("openai", "sk-secret-aaa");
  const b = llmQuotaGateKey("openai", "sk-secret-aaa");
  const c = llmQuotaGateKey("openai", "sk-secret-bbb");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.includes("sk-secret"), false);
});

test("acquireLlmQuotaSlot limits concurrent holders for same key", async () => {
  const key = llmQuotaGateKey("openai", "k1");
  const release1 = await acquireLlmQuotaSlot(key);
  const release2 = await acquireLlmQuotaSlot(key);
  assert.equal(getLlmQuotaGateStats(key).inFlight, 2);

  let thirdAcquired = false;
  const thirdPromise = acquireLlmQuotaSlot(key).then((release) => {
    thirdAcquired = true;
    return release;
  });

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(thirdAcquired, false);
  assert.equal(getLlmQuotaGateStats(key).queued, 1);

  release1();
  const release3 = await thirdPromise;
  assert.equal(thirdAcquired, true);
  assert.equal(getLlmQuotaGateStats(key).inFlight, 2);
  release2();
  release3();
  assert.equal(getLlmQuotaGateStats(key).inFlight, 0);
});

test("markLlmQuotaCooldown blocks new acquires until elapsed", async () => {
  configureLlmQuotaGateDefaults({ maxConcurrent: 2, maxQueueWaitMs: 5_000 });
  const key = llmQuotaGateKey("openai", "cooldown-key");
  markLlmQuotaCooldown(key, 120);
  const started = Date.now();
  const release = await acquireLlmQuotaSlot(key);
  assert.ok(Date.now() - started >= 100);
  release();
});

test("different quota keys do not share concurrency slots", async () => {
  configureLlmQuotaGateDefaults({ maxConcurrent: 1, maxQueueWaitMs: 5_000 });
  const a = llmQuotaGateKey("openai", "tenant-a");
  const b = llmQuotaGateKey("openai", "tenant-b");
  const ra = await acquireLlmQuotaSlot(a);
  const rb = await acquireLlmQuotaSlot(b);
  assert.equal(getLlmQuotaGateStats(a).inFlight, 1);
  assert.equal(getLlmQuotaGateStats(b).inFlight, 1);
  ra();
  rb();
});

test("withConversationAgentReplyLock serializes same conversation", async () => {
  const order: number[] = [];
  const slow = withConversationAgentReplyLock("conv-1", async () => {
    order.push(1);
    await new Promise((r) => setTimeout(r, 60));
    order.push(2);
    return "a";
  });
  const fast = withConversationAgentReplyLock("conv-1", async () => {
    order.push(3);
    return "b";
  });
  const [a, b] = await Promise.all([slow, fast]);
  assert.equal(a, "a");
  assert.equal(b, "b");
  assert.deepEqual(order, [1, 2, 3]);
});

test("withLlmQuotaSlot releases even when fn throws", async () => {
  const key = llmQuotaGateKey("openai", "throw-key");
  await assert.rejects(
    () =>
      withLlmQuotaSlot(key, async () => {
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(getLlmQuotaGateStats(key).inFlight, 0);
});
