/**
 * Fase 7 — Agente prompt-only «Clínica Veterinária» (generalização zero hotel).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTurnContext } from "../core/buildTurnContext.js";
import { planScheduledToolInvocations } from "../scheduler/TurnToolScheduler.js";
import { buildUnifiedExecutionPlan } from "../planner/UnifiedExecutionPlanner.js";
import { compilePromptToIR } from "../compiler/PromptCompiler.js";

const VET_PLAYBOOK = {
  promptBuilder: {
    userCore: `
## Objetivo
Agendar consulta veterinária para pets.

## Ferramentas
| Passo | Tool |
| Confirmar | \`agendar_consulta\` |

## Restrições
Nunca inventar preços ou diagnósticos.
`,
  },
};

const VET_TOOLS = [
  {
    name: "agendar_consulta",
    config: {
      eil: {
        capabilities: ["booking"],
        produces: ["appointmentId"],
        requiresFacts: ["petName"],
      },
    },
  },
  { name: "buscar_conhecimento", config: {} },
];

test("vet clinic compiles IR without hotel/checkin patterns", () => {
  const ir = compilePromptToIR({
    behaviorConfig: VET_PLAYBOOK,
    userMessage: "Quero agendar consulta para o Rex amanhã de manhã",
    availableToolNames: ["agendar_consulta", "buscar_conhecimento"],
  });
  assert.match(ir.objective ?? "", /consulta veterin/i);
  assert.equal(
    ir.preconditions.some((p) => p.includes("embratur") || p.includes("__templateFacts.checkinLink")),
    false,
  );
});

test("vet clinic buildTurnContext + planner + scheduler (no checkin imports)", () => {
  const ctx = buildTurnContext({
    turnId: "vet-turn-1",
    behaviorConfig: VET_PLAYBOOK,
    userMessage: "Agendar consulta para a Luna, gata, amanhã",
    availableToolNames: ["agendar_consulta", "buscar_conhecimento"],
    toolConfigs: VET_TOOLS,
    memory: { flowSlots: { petName: "Luna" } },
  });
  assert.equal(ctx.executionContract.turnId, "vet-turn-1");
  assert.equal(ctx.promptIr.metadata.hash.length > 0, true);

  const plan = buildUnifiedExecutionPlan({
    behaviorConfig: { ...VET_PLAYBOOK, eil: { enabled: true } },
    userMessage: ctx.userMessage,
    availableToolNames: ctx.availableToolNames,
    promptIr: ctx.promptIr,
    facts: ctx.facts,
    graph: ctx.capabilityGraph,
    toolsCalled: [],
  });
  assert.equal(plan.eilEnabled, true);

  const scheduled = planScheduledToolInvocations(ctx, []);
  assert.equal(Array.isArray(scheduled), true);
});
