import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTurnPolicy,
  turnPolicyPreExecBlockReasonForTurn,
} from "./turnPolicyParser.js";
import { resolveRequiredToolNamesForTurn } from "./requiredToolNamesParser.js";

const playbook = `
| C3 | **Check-in explícito** | \`fazer check-in\` + localizador | Chame \`audaar_consultar_reserva\` · **PROIBIDO** \`buscar_conhecimento\` · PARE | consultar_reserva |
**Proibido** \`buscar_conhecimento\` + \`audaar_consultar_reserva\` no mesmo turno
`;

test("oc_tool UUID must not block required HTTP tool via ?? fallback", () => {
  const behavior = { promptBuilder: { useFullPrompt: true, userCore: playbook } };
  const userMessage = "fazer check-in na reserva FRJA2DBZ";
  const policy = resolveTurnPolicy(behavior, { userMessage });
  const required = resolveRequiredToolNamesForTurn(behavior, {
    userMessage,
    availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
  });
  assert.ok(required.includes("audaar_consultar_reserva"));

  const blockCanonical = turnPolicyPreExecBlockReasonForTurn(
    "audaar_consultar_reserva",
    [],
    policy,
    required,
  );
  const blockUuid = turnPolicyPreExecBlockReasonForTurn(
    "oc_tool_93546189e980494bb825185fa44676af",
    [],
    policy,
    required,
  );

  assert.equal(blockCanonical, null, "canonical required tool must be allowed");
  assert.ok(blockUuid, "UUID alone looks like non-required and would block");

  // Bug reproduced in agentNativeLlm: null ?? uuidBlock → blocks the required tool
  const buggy = blockCanonical ?? blockUuid;
  assert.ok(buggy, "demonstrates ?? false-positive block");

  // Correct: use only canonical HTTP tool name
  const correct = blockCanonical;
  assert.equal(correct, null);
});
