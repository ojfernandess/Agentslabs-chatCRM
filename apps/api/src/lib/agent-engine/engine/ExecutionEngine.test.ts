import assert from "node:assert/strict";
import test from "node:test";
import { sharedExecutionEngine, beginEngineTurn } from "./index.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { AgentRuntimeExecuteInput } from "../types.js";

const HOTEL_PLAYBOOK = `
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
| N=1 → S9 | Sim → só \`embratur-reference\` · só \`mainGuestId\` · só \`brasileiro\` |
| S10 | concluído | Chame \`audaar_check_in\` |
`;

const RETAIL_PLAYBOOK = `
Proibido \`crm_validate_cart\` + \`crm_submit_order\` no mesmo turno.
| Confirm | sim | só \`crm_validate_cart\` |
| Final | concluído | Chame \`crm_submit_order\` |
`;

function mockInput(
  runtime: "openconduit" | "langgraph",
  playbook: string,
  userMessage: string,
): AgentRuntimeExecuteInput {
  const engineConfig = parseAgentEngineConfig({
    agentEngine: { runtime, schedulerEnabled: false, resilienceEnabled: false },
  });
  return {
    organizationId: "org-1",
    bot: { id: "bot-1" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv-1" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg-1", body: userMessage } as AgentRuntimeExecuteInput["message"],
    log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } as never,
    engineConfig,
    llmConfig: {},
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: playbook },
      agentEngine: { runtime },
    },
  };
}

test("ExecutionEngine beginTurn rejects fake exclusive tools on guest confirm", () => {
  const input = mockInput("openconduit", HOTEL_PLAYBOOK, "Sim");
  const state = beginEngineTurn(input, {});
  assert.deepEqual(state.plan.requiredToolNames, ["embratur-reference"]);
  assert.equal(state.plan.requiredToolNames.includes("mainguestid"), false);
  assert.equal(state.plan.requiredToolNames.includes("brasileiro"), false);
  assert.ok(state.timeline.some((e) => e.phase === "plan"));
  assert.equal(state.turnContext.intent.kind, "confirmation");
});

test("ExecutionEngine openconduit vs langgraph parity on required tools", () => {
  const open = beginEngineTurn(mockInput("openconduit", HOTEL_PLAYBOOK, "Sim"), {});
  const lg = beginEngineTurn(mockInput("langgraph", HOTEL_PLAYBOOK, "Sim"), {});
  assert.deepEqual(open.plan.requiredToolNames, lg.plan.requiredToolNames);
  assert.deepEqual(
    open.plan.turnPolicy.exclusiveAllowedTools,
    lg.plan.turnPolicy.exclusiveAllowedTools,
  );
});

test("ExecutionEngine retail confirm requires validate_cart only", () => {
  const state = beginEngineTurn(mockInput("openconduit", RETAIL_PLAYBOOK, "sim"), {});
  assert.ok(state.plan.requiredToolNames.some((t) => t.includes("validate_cart")));
  assert.equal(state.plan.requiredToolNames.some((t) => t.includes("submit")), false);
});

test("ExecutionEngine refreshTurn updates contract after tools", () => {
  const input = mockInput("langgraph", HOTEL_PLAYBOOK, "Sim");
  let state = sharedExecutionEngine.beginTurn({ input, memory: {} });
  assert.ok(state.contract.pendingToolNames.includes("embratur-reference"));
  assert.equal(state.freezeCompletionPromotion, true);
  state = sharedExecutionEngine.refreshTurnWithBehavior(state, input.behaviorConfig, {
    toolOutcomes: [{ name: "embratur-reference", ok: true }],
    phase: "validate",
  });
  assert.equal(state.contract.pendingToolNames.includes("embratur-reference"), false);
  assert.ok(state.contract.satisfiedToolNames.includes("embratur-reference"));
  assert.equal(
    state.contract.pendingToolNames.some((t) => /check[_-]?in/i.test(t)),
    false,
    "must not promote check_in mid-turn after exclusive gate",
  );
  assert.ok(state.timeline.some((e) => e.phase === "validate"));
});

test("ExecutionEngine replanWithWorkflow merges plannedToolNames into required", () => {
  const input = mockInput("openconduit", HOTEL_PLAYBOOK, "Sim");
  let state = sharedExecutionEngine.beginTurn({ input, memory: {} });
  state = sharedExecutionEngine.attachWorkflow(state, {
    version: 1,
    workflowId: "implicit-turn-v1",
    runId: "r1",
    organizationId: "org-1",
    conversationId: "conv-1",
    status: "running",
    currentStepId: "schedule_required",
    completedStepIds: ["intent"],
    plannedToolNames: ["audaar_consultar_reserva"],
    toolResults: [],
    vars: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    compensationStack: [],
    iterationCounts: {},
  });
  state = sharedExecutionEngine.replanWithWorkflow(state, input.behaviorConfig, { memory: {} });
  assert.ok(state.plan.requiredToolNames.includes("audaar_consultar_reserva"));
  assert.ok(state.plan.requiredToolNames.includes("embratur-reference"));
  assert.ok(state.timeline.some((e) => e.detail?.includes("workflow_merge")));
});

test("parseAgentEngineConfig legacyOpenconduitBypass default false", () => {
  const cfg = parseAgentEngineConfig({ agentEngine: { runtime: "openconduit" } });
  assert.equal(cfg.legacyOpenconduitBypass, false);
  const bypass = parseAgentEngineConfig({
    agentEngine: { runtime: "openconduit", legacyOpenconduitBypass: true },
  });
  assert.equal(bypass.legacyOpenconduitBypass, true);
});

test("buildExecutionTurnPlan matches Engine plan for same playbook", () => {
  const behavior = {
    promptBuilder: { useFullPrompt: true, userCore: HOTEL_PLAYBOOK },
  };
  const plan = buildExecutionTurnPlan({
    behaviorConfig: behavior,
    userMessage: "Sim",
    availableToolNames: ["embratur-reference", "audaar_check_in", "buscar_conhecimento"],
  });
  const engine = beginEngineTurn(
    {
      ...mockInput("openconduit", HOTEL_PLAYBOOK, "Sim"),
      behaviorConfig: behavior,
    },
    {},
    ["embratur-reference", "audaar_check_in", "buscar_conhecimento"],
  );
  assert.deepEqual(plan.requiredToolNames, engine.plan.requiredToolNames);
});
