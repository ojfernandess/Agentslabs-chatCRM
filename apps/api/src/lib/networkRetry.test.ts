import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableNetworkError, withNetworkRetry } from "./networkRetry.js";

test("isRetryableNetworkError detects fetch failed", () => {
  assert.equal(isRetryableNetworkError(new Error("fetch failed")), true);
  assert.equal(isRetryableNetworkError(new Error("Meta API error: 400 bad request")), false);
});

test("isRetryableNetworkError detects Meta 503", () => {
  assert.equal(isRetryableNetworkError(new Error("Meta API error: 503 upstream")), true);
});

test("withNetworkRetry succeeds after transient failure", async () => {
  let calls = 0;
  const result = await withNetworkRetry(async () => {
    calls += 1;
    if (calls < 2) throw new Error("fetch failed");
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 1 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withNetworkRetry does not retry non-retryable errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withNetworkRetry(async () => {
        calls += 1;
        throw new Error("Meta API error: 400 invalid parameter");
      }, { maxAttempts: 3, baseDelayMs: 1 }),
    /400 invalid parameter/,
  );
  assert.equal(calls, 1);
});
