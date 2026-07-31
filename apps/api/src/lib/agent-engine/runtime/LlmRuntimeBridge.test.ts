import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTurnContext } from "../core/buildTurnContext.js";
import { appendPackedLlmContext, gateLlmToolCall } from "./LlmRuntimeBridge.js";

const PLAYBOOK = {
  promptBuilder: {
    userCore: "## Objetivo\nResponder.\n| Passo | Tool |\n| A | `foo` |\n",
  },
};

test("appendPackedLlmContext adds step slice", () => {
  const ctx = buildTurnContext({
    turnId: "t1",
    behaviorConfig: PLAYBOOK,
    userMessage: "olá",
    availableToolNames: ["foo"],
  });
  const out = appendPackedLlmContext("BASE", ctx);
  assert.match(out, /BASE/);
  assert.match(out, /contexto do passo/i);
});

test("gateLlmToolCall blocks forbidden tool via sandbox", () => {
  const ctx = buildTurnContext({
    turnId: "t2",
    behaviorConfig: {},
    userMessage: "test",
    availableToolNames: ["foo", "bar"],
  });
  ctx.executionContract.forbiddenToolNames = ["bar"];
  const gate = gateLlmToolCall({
    toolName: "bar",
    turnContext: ctx,
    alreadyCalledThisTurn: ["foo"],
  });
  assert.equal(gate.allowed, false);
  assert.ok(gate.blockJson);
});
