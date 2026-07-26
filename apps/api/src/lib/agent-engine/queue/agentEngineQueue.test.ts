import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentEngineQueuePriority } from "./agentEngineQueue.js";

test("resolveAgentEngineQueuePriority maps conversation priority", () => {
  assert.equal(resolveAgentEngineQueuePriority("URGENT"), 20);
  assert.equal(resolveAgentEngineQueuePriority("HIGH"), 15);
  assert.equal(resolveAgentEngineQueuePriority("MEDIUM"), 5);
  assert.equal(resolveAgentEngineQueuePriority("LOW"), 1);
  assert.equal(resolveAgentEngineQueuePriority(null), 5);
});
