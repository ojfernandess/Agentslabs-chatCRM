import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAgentGraphCheckpointersForTests,
  getAgentGraphCheckpointer,
  resolveAgentCheckpointMode,
} from "./AgentCheckpointFactory.js";

test("getAgentGraphCheckpointer reuses instance per scope", () => {
  clearAgentGraphCheckpointersForTests();
  const a = getAgentGraphCheckpointer("memory", "org-1");
  const b = getAgentGraphCheckpointer("memory", "org-1");
  const c = getAgentGraphCheckpointer("memory", "org-2");
  assert.equal(a, b);
  assert.notEqual(a, c);
  clearAgentGraphCheckpointersForTests();
});

test("resolveAgentCheckpointMode defaults to memory", () => {
  assert.equal(resolveAgentCheckpointMode("memory"), "memory");
  assert.equal(resolveAgentCheckpointMode(undefined), "memory");
});
