import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHitlPendingForTests,
  listHitlPending,
  registerHitlPending,
  resolveHitlPending,
} from "./HumanInTheLoopStore.js";

test("HumanInTheLoopStore register list resolve", () => {
  clearHitlPendingForTests();
  const row = registerHitlPending({
    organizationId: "org-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    botId: "bot-1",
    replyPreview: "Resposta proposta",
    supervisorSummary: "Falha knowledge_used",
  });
  assert.equal(listHitlPending("org-1").length, 1);
  const resolved = resolveHitlPending(row.id, "org-1", "approved");
  assert.equal(resolved?.status, "approved");
  assert.equal(listHitlPending("org-1").length, 0);
  clearHitlPendingForTests();
});
