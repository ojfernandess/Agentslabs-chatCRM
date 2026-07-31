import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePromptToIR } from "../compiler/PromptCompiler.js";
import {
  buildUnifiedExecutionPlan,
  executionTurnPlanFromPromptIr,
} from "./UnifiedExecutionPlanner.js";
import { buildExecutionTurnPlan } from "./ExecutionTurnPlan.js";
import { buildPlanGraph, resolveActiveFlowStep } from "./PlanGraphBuilder.js";
import { buildCapabilityGraph } from "../eil/CapabilityGraph.js";
import { evaluatePromptIrPolicyRules } from "../eil/PolicyEngine.js";

const SAMPLE_PLAYBOOK = {
  promptBuilder: {
    useFullPrompt: true,
    userCore: `
| C2 | Verificar | consultar + localizador | Chame \`audaar_consultar_reserva\` |
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
Confirmação: após OK do titular chame \`embratur-reference\`.
`,
  },
};

test("buildUnifiedExecutionPlan matches buildExecutionTurnPlan required tools", () => {
  const opts = {
    behaviorConfig: SAMPLE_PLAYBOOK,
    userMessage: "pode consultar essa reserva QP7ZVTOG",
    availableToolNames: ["audaar_consultar_reserva", "embratur-reference"],
  };
  const legacy = buildExecutionTurnPlan(opts);
  const unified = buildUnifiedExecutionPlan(opts);
  assert.deepEqual(
    [...unified.requiredToolNames].sort(),
    [...legacy.requiredToolNames].sort(),
  );
  assert.equal(unified.turnPolicy.blockEscalation, legacy.turnPolicy.blockEscalation);
  assert.ok(unified.planGraph.orderedToolNames.length >= 0);
  assert.ok(unified.promptIrHash);
});

test("executionTurnPlanFromPromptIr does not re-resolve turnPolicy", () => {
  const ir = compilePromptToIR({
    behaviorConfig: SAMPLE_PLAYBOOK,
    userMessage: "sim",
    availableToolNames: ["embratur-reference"],
  });
  const plan = executionTurnPlanFromPromptIr(ir, {
    behaviorConfig: SAMPLE_PLAYBOOK,
    userMessage: "sim",
  });
  assert.equal(plan.turnPolicy, ir.turnPolicy);
  assert.deepEqual(plan.requiredToolNames, ir.tools.required);
});

test("buildPlanGraph orders required tools with fact deps", () => {
  const graph = buildCapabilityGraph({
    tools: [
      { name: "audaar_consultar_reserva", config: { producesFacts: ["reservation.uid"] } },
      { name: "embratur-reference", config: { requiresFacts: ["reservation.uid"] } },
    ],
  });
  const planGraph = buildPlanGraph({
    flows: [],
    requiredToolNames: ["embratur-reference", "audaar_consultar_reserva"],
    graph,
    facts: {},
  });
  assert.ok(planGraph.nodes.some((n) => n.kind === "tool"));
});

test("evaluatePromptIrPolicyRules detects forbidden same-turn pair", () => {
  const result = evaluatePromptIrPolicyRules({
    rules: [
      {
        id: "p1",
        kind: "forbidden_same_turn_pair",
        pair: { a: "embratur-reference", b: "audaar_check_in" },
      },
    ],
    facts: {},
    toolsCalledThisTurn: ["embratur-reference", "audaar_check_in"],
    turnPolicy: { blockEscalation: false },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.blockedSameTurnPairs.length, 1);
});

test("resolveActiveFlowStep picks first pending flow step", () => {
  const step = resolveActiveFlowStep(
    [
      {
        id: "f1",
        label: "Check-in",
        steps: [
          { id: "s9", label: "S9", toolNames: ["embratur-reference"], preconditions: [], postconditions: [] },
          { id: "s10", label: "S10", toolNames: ["audaar_check_in"], preconditions: [], postconditions: [] },
        ],
      },
    ],
    [],
  );
  assert.equal(step?.stepId, "s9");
});
