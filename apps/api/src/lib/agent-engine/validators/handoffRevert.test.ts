import assert from "node:assert/strict";
import test from "node:test";
import { shouldRevertHandoffAfterValidation } from "./handoffRevert.js";
import { resolveTurnPolicy } from "./turnPolicyParser.js";

const PLAYBOOK = `
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
N=1 → S9 só \`embratur-reference\`
`;

test("shouldRevertHandoffAfterValidation when transfer ran on sim turn", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(
    shouldRevertHandoffAfterValidation(
      [
        { name: "embratur-reference", ok: true },
        { name: "transfer_to_team", ok: true },
      ],
      ["Escalonamento proibido neste turno"],
      policy,
    ),
    true,
  );
});

test("shouldRevertHandoffAfterValidation false when no escalation tool succeeded", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(
    shouldRevertHandoffAfterValidation(
      [{ name: "embratur-reference", ok: true }],
      ["Ferramenta fora da categoria"],
      policy,
    ),
    false,
  );
});

test("shouldRevertHandoffAfterValidation uses policy alerts when validator empty", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(
    shouldRevertHandoffAfterValidation(
      [
        { name: "embratur-reference", ok: true },
        { name: "transfer_to_team", ok: true },
        { name: "set_conversation_status", ok: true },
      ],
      [],
      policy,
    ),
    true,
  );
});
