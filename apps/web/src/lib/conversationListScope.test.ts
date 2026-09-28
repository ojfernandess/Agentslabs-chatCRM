import assert from "node:assert/strict";
import test from "node:test";
import { mergeConversationScopeHint, type ConversationScopeRow } from "./conversationListScope.js";

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

test("mergeConversationScopeHint — assignedToId sem nome usa utilizador actual", () => {
  const unassignedRow: ConversationScopeRow = {
    id: "conv-1",
    status: "OPEN",
    assignedToId: null,
    assignedTo: null,
  };
  const merged = mergeConversationScopeHint(
    unassignedRow,
    { assignedToId: "user-2" },
    { currentUserId: "user-2", currentUserName: "João" },
  );
  assert.equal(merged.assignedTo?.id, "user-2");
  assert.equal(merged.assignedTo?.name, "João");
});

test("mergeConversationScopeHint — assignedToId sem nome preserva nome existente", () => {
  const merged = mergeConversationScopeHint(baseRow, { assignedToId: "user-1" });
  assert.equal(merged.assignedTo?.name, "Maria");
});

test("mergeConversationScopeHint — assignedTo vazio preserva nome da linha", () => {
  const merged = mergeConversationScopeHint(baseRow, {
    assignedToId: "user-1",
    assignedTo: { id: "user-1", name: "" },
  });
  assert.equal(merged.assignedTo?.name, "Maria");
});
