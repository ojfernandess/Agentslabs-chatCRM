import assert from "node:assert/strict";
import test from "node:test";
import {
  initRedisLangGraphCheckpointer,
  isRedisStackCheckpointAvailable,
  resetRedisLangGraphCheckpointerForTests,
} from "./RedisLangGraphCheckpointer.js";

test("initRedisLangGraphCheckpointer skips without REDIS_URL", async () => {
  await resetRedisLangGraphCheckpointerForTests();
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const ok = await initRedisLangGraphCheckpointer();
  assert.equal(ok, false);
  assert.equal(isRedisStackCheckpointAvailable(), false);
  if (prev) process.env.REDIS_URL = prev;
  await resetRedisLangGraphCheckpointerForTests();
});
