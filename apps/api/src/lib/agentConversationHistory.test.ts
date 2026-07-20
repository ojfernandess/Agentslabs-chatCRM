import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeAgentInboundMediaWhere,
  buildNativeAgentMessageWhere,
  buildNativeAgentTranscriptWhere,
} from "./agentConversationHistory.js";

test("buildNativeAgentMessageWhere without clear is only conversation + exclude id", () => {
  const w = buildNativeAgentMessageWhere({
    conversationId: "c1",
    excludeMessageId: "m0",
    lastClearedAt: null,
  });
  assert.equal(w.conversationId, "c1");
  assert.deepEqual(w.id, { not: "m0" });
  assert.equal(w.isPrivate, false);
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
  assert.equal(w.isPrivate, false);
});

test("buildNativeAgentTranscriptWhere excludes private messages and applies clear cutoff", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentTranscriptWhere({ conversationId: "c1", lastClearedAt: t });
  assert.equal(w.conversationId, "c1");
  assert.equal(w.isPrivate, false);
  assert.deepEqual(w.createdAt, { gt: t });
});

test("buildNativeAgentInboundMediaWhere filters inbound media after clear", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentInboundMediaWhere({ conversationId: "c1", lastClearedAt: t });
  assert.equal(w.direction, "INBOUND");
  assert.deepEqual(w.createdAt, { gt: t });
});
