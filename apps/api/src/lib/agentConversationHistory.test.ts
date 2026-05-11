import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeAgentMessageWhere } from "./agentConversationHistory.js";

test("buildNativeAgentMessageWhere without clear is only conversation + exclude id", () => {
  const w = buildNativeAgentMessageWhere({
    conversationId: "c1",
    excludeMessageId: "m0",
    lastClearedAt: null,
  });
  assert.equal(w.conversationId, "c1");
  assert.deepEqual(w.id, { not: "m0" });
  assert.equal(w.createdAt, undefined);
});

test("buildNativeAgentMessageWhere applies createdAt gt when lastClearedAt set", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentMessageWhere({
    conversationId: "c1",
    excludeMessageId: "m0",
    lastClearedAt: t,
  });
  assert.deepEqual(w.createdAt, { gt: t });
});
