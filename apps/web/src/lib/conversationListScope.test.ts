import assert from "node:assert/strict";
import test from "node:test";
import { mergeConversationScopeHint } from "./conversationListScope.js";

const baseRow = {
  id: "conv-1",
  status: "OPEN",
  assignedToId: "user-1",
  assignedTo: { id: "user-1", name: "Maria" },
};

test("mergeConversationScopeHint — ignora assignedTo null espúrio do WS", () => {
  const merged = mergeConversationScopeHint(baseRow, {
    assignedToId: "user-1",
    assignedTo: null,
  });
  assert.equal(merged.assignedTo?.id, "user-1");
  assert.equal(merged.assignedTo?.name, "Maria");
});

test("mergeConversationScopeHint — limpa assignee quando assignedToId é null", () => {
  const merged = mergeConversationScopeHint(baseRow, {
    assignedToId: null,
    assignedTo: null,
  });
  assert.equal(merged.assignedToId, null);
  assert.equal(merged.assignedTo, null);
});
