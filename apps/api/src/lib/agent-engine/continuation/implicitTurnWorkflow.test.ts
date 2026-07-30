import assert from "node:assert/strict";
import test from "node:test";
import {
  IMPLICIT_TURN_WORKFLOW_ID,
  advanceImplicitWorkflowPhase,
  buildImplicitTurnWorkflowDefinition,
  materializeImplicitWorkflowRun,
} from "./implicitTurnWorkflow.js";

test("buildImplicitTurnWorkflowDefinition chains required tools into planned steps", () => {
  const def = buildImplicitTurnWorkflowDefinition(["audaar_consultar_reserva", "embratur-reference"]);
  assert.equal(def.id, IMPLICIT_TURN_WORKFLOW_ID);
  assert.equal(def.entry, "intent");
  assert.equal(def.steps.tool_0?.kind, "tool");
  assert.equal(def.steps.tool_0?.toolName, "audaar_consultar_reserva");
  assert.equal(def.steps.tool_1?.toolName, "embratur-reference");
  assert.equal(def.steps.tool_1?.next, "facts");
});

test("materializeImplicitWorkflowRun exposes plannedToolNames for Contract merge", () => {
  const { state } = materializeImplicitWorkflowRun({
    organizationId: "org-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    requiredToolNames: ["crm_validate_cart"],
    userMessage: "sim",
  });
  assert.deepEqual(state.plannedToolNames, ["crm_validate_cart"]);
  assert.equal(state.currentStepId, "schedule_required");
  assert.equal(state.vars.implicit, true);
});

test("advanceImplicitWorkflowPhase completes on end", () => {
  const { state } = materializeImplicitWorkflowRun({
    organizationId: "org-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    requiredToolNames: [],
    userMessage: "oi",
  });
  const ended = advanceImplicitWorkflowPhase(state, "end");
  assert.equal(ended.status, "completed");
  assert.equal(ended.currentStepId, "end");
});
