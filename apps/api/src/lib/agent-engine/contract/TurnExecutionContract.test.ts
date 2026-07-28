import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenericReplyOnlyRetryPromptBlock,
  formatPriorToolFactsForReplyOnly,
  pendingRequiredToolNames,
  shouldAllowPlainChatFallback,
  shouldUseReplyOnlyRetryForTurn,
} from "./TurnExecutionContract.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";

const checkinPlaybook = `
| C3 | **Check-in explícito** | \`fazer check-in\` + localizador | Chame \`audaar_consultar_reserva\` · **PROIBIDO** \`buscar_conhecimento\` · PARE | consultar_reserva |
**Proibido** \`buscar_conhecimento\` + \`audaar_consultar_reserva\` no mesmo turno
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
`;

test("shouldAllowPlainChatFallback blocks when required tool pending", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "fazer check-in FRJA2DBZ",
    availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
  });
  assert.equal(shouldAllowPlainChatFallback({ turnPlan, toolsAlreadyRun: [] }), false);
  assert.equal(
    shouldAllowPlainChatFallback({
      turnPlan,
      toolsAlreadyRun: [{ name: "audaar_consultar_reserva", ok: true }],
    }),
    true,
  );
});

test("pendingRequiredToolNames detects missing mandatory tool", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "fazer check-in FRJA2DBZ",
    availableToolNames: ["audaar_consultar_reserva"],
  });
  assert.deepEqual(pendingRequiredToolNames(turnPlan, []), ["audaar_consultar_reserva"]);
  assert.deepEqual(
    pendingRequiredToolNames(turnPlan, [{ name: "audaar_consultar_reserva", ok: true }]),
    [],
  );
});

test("shouldUseReplyOnlyRetryForTurn full retry when required tool missing", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "fazer check-in FRJA2DBZ",
    availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
  });
  assert.equal(
    shouldUseReplyOnlyRetryForTurn({
      turnPlan,
      toolOutcomes: [],
      supervisorChecks: [{ id: "tool_used", passed: false }],
      validationAlerts: ["Ferramenta obrigatória não utilizada: audaar_consultar_reserva"],
    }),
    false,
  );
});

test("shouldUseReplyOnlyRetryForTurn full retry on forbidden KB+lookup pair without side effects", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "fazer check-in FRJA2DBZ",
    availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
  });
  assert.equal(
    shouldUseReplyOnlyRetryForTurn({
      turnPlan,
      toolOutcomes: [
        { name: "buscar_conhecimento", ok: true },
        { name: "audaar_consultar_reserva", ok: true },
      ],
      supervisorChecks: [
        { id: "validation_passed", passed: false },
        { id: "tool_used", passed: true },
      ],
      validationAlerts: ["Par proibido no mesmo turno"],
    }),
    false,
  );
});

test("shouldUseReplyOnlyRetryForTurn reply-only when illegal transfer already executed", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "sim",
    availableToolNames: ["embratur-reference", "transfer_to_team", "audaar_check_in"],
  });
  assert.equal(
    shouldUseReplyOnlyRetryForTurn({
      turnPlan,
      toolOutcomes: [
        { name: "embratur-reference", ok: true },
        { name: "transfer_to_team", ok: true },
      ],
      supervisorChecks: [
        { id: "validation_passed", passed: false },
        { id: "tool_used", passed: true },
      ],
    }),
    true,
  );
});

test("buildGenericReplyOnlyRetryPromptBlock is segment-agnostic", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "sim",
    availableToolNames: ["audaar_check_in"],
  });
  const block = buildGenericReplyOnlyRetryPromptBlock({ turnPlan, userMessage: "sim" });
  assert.match(block, /retry reply-only/i);
  assert.match(block, /PROIBIDO.*invocar ferramentas/i);
  assert.match(block, /Confirmação detectada/i);
  assert.doesNotMatch(block, /Embratur|CPF|audaar_consultar_reserva/);
});

test("buildGenericReplyOnlyRetryPromptBlock injects prior tool facts", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: checkinPlaybook } },
    userMessage: "41026299802",
    availableToolNames: ["audaar_consultar_main_guest"],
  });
  const block = buildGenericReplyOnlyRetryPromptBlock({
    turnPlan,
    userMessage: "41026299802",
    priorSuccessfulToolOutcomes: [
      {
        name: "audaar_consultar_main_guest",
        ok: true,
        preview: JSON.stringify({ found: true, name: "Odair", documentNumber: "41026299802" }),
      },
    ],
  });
  assert.match(block, /factos das ferramentas/i);
  assert.match(block, /audaar_consultar_main_guest/);
  assert.match(block, /Odair/);
  assert.match(block, /undefined/);
  assert.match(block, /PROIBIDO.*flowSlots/i);
});

test("formatPriorToolFactsForReplyOnly skips failed tools", () => {
  const facts = formatPriorToolFactsForReplyOnly([
    { name: "ok_tool", ok: true, preview: '{"a":1}' },
    { name: "fail_tool", ok: false, preview: "error" },
  ]);
  assert.match(facts, /ok_tool/);
  assert.doesNotMatch(facts, /fail_tool/);
});
