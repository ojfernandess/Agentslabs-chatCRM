import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationSuppressedFromBellUnderHumanAllScope,
  resolveConversationBellNotify,
} from "./conversationBellScope.js";

test("bot queue pending is suppressed when human-all scope is on", () => {
  assert.equal(
    conversationSuppressedFromBellUnderHumanAllScope(
      {
        status: "PENDING",
        assignedToId: null,
        awaitingHumanHandoff: false,
        agentBotTriageActive: true,
      },
      true,
    ),
    true,
  );
});

test("handoff after call_human is not suppressed", () => {
  assert.equal(
    resolveConversationBellNotify({
      conversationsAllScopeHumanOnly: true,
      agentBotTriageActive: true,
      status: "PENDING",
      assignedToId: null,
      awaitingHumanHandoff: true,
    }),
    true,
  );
});

test("human assigned conversation still notifies", () => {
  assert.equal(
    resolveConversationBellNotify({
      conversationsAllScopeHumanOnly: true,
      agentBotTriageActive: true,
      status: "OPEN",
      assignedToId: "user-1",
      awaitingHumanHandoff: false,
    }),
    true,
  );
});
