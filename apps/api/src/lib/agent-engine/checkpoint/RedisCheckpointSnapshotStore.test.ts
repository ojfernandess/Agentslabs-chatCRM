import assert from "node:assert/strict";
import test from "node:test";
import {
  readCheckpointSnapshotFromRedis,
  writeCheckpointSnapshotToRedis,
} from "./RedisCheckpointSnapshotStore.js";

test("RedisCheckpointSnapshotStore skips when redis unavailable", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const wrote = await writeCheckpointSnapshotToRedis("org-1", {
    threadId: "c:m",
    next: ["respond"],
    values: { reply: "test" },
  });
  assert.equal(wrote, false);
  const read = await readCheckpointSnapshotFromRedis("org-1", "c:m");
  assert.equal(read, null);
  if (prev) process.env.REDIS_URL = prev;
});
