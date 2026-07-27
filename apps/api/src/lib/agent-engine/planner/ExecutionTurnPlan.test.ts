import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionTurnPlan } from "./ExecutionTurnPlan.js";
import { shouldBlockOutboundFromWorkflow, validateAgentWorkflow } from "../audit/WorkflowValidator.js";
import { runWorkflowGate } from "../audit/applyWorkflowGate.js";

test("buildExecutionTurnPlan requires only consultar_reserva for C2 message", () => {
  const plan = buildExecutionTurnPlan({
    behaviorConfig: {
      promptBuilder: {
        useFullPrompt: true,
        userCore: `
| C2 | Verificar | consultar + localizador | Chame \`audaar_consultar_reserva\` |
| C8 | CPF | 11 dígitos | Chame \`audaar_consultar_main_guest\` |
Sempre use buscar_conhecimento. Chame \`audaar_check_in\`.
`,
      },
    },
    userMessage: "pode consultar essa reserva QP7ZVTOG",
  });
  assert.ok(plan.requiredToolNames.some((n) => /consultar_reserva/i.test(n)));
  assert.ok(plan.requiredToolNames.length <= 2);
  assert.equal(plan.knowledgeSeeking, false);
  assert.ok(plan.matchedPatternIds.includes("checkin_or_reservation"));
});

test("runWorkflowGate never sets blockReply even when report fails", () => {
  const gate = runWorkflowGate({
    engineConfig: {
      runtime: "langgraph",
      memory: "openconduit",
      supervisorEnabled: true,
      supervisorMode: "both",
      strictMode: true,
      observability: "full",
    },
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: "Chame `consultar_saldo`" } },
    userMessage: "Qual o saldo?",
    replyText: "O saldo é 10.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });
  assert.equal(gate.blockReply, false);
  assert.ok((gate.advisoryFailures ?? 0) >= 0);
});

test("shouldBlockOutboundFromWorkflow is always false (diagnostic-only)", () => {
  const report = validateAgentWorkflow({
    userMessage: "41026299802",
    replyText: "Encontrei seu cadastro. Confirme os dados do titular: Nome João.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    supervisorEnabled: true,
  });
  assert.equal(report.approved, false);
  assert.equal(shouldBlockOutboundFromWorkflow(report), false);
});
