import assert from "node:assert/strict";
import test from "node:test";
import { resetMetaGraphConcurrencyForTests, withMetaGraphSlot } from "./metaGraphConcurrency.js";

test("withMetaGraphSlot limits concurrent executions", async () => {
  resetMetaGraphConcurrencyForTests({ maxConcurrent: 2 });
  let running = 0;
  let maxSeen = 0;

  const task = async () => {
    running += 1;
    maxSeen = Math.max(maxSeen, running);
    await new Promise((r) => setTimeout(r, 30));
    running -= 1;
  };

  await Promise.all([withMetaGraphSlot(task), withMetaGraphSlot(task), withMetaGraphSlot(task)]);
  assert.equal(maxSeen, 2);
});
