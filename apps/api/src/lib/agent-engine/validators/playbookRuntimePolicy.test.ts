import assert from "node:assert/strict";
import test from "node:test";
import {
  isLikelyMutableOrCompletionTool,
  isLikelyUploadOrMediaTool,
  lineDescribesConfirmationExclusiveTools,
  shouldExcludeCompletionToolFromRequired,
} from "./playbookRuntimePolicy.js";
import { resolveTurnPolicy, turnPolicyPreExecBlockReason } from "./turnPolicyParser.js";
import { resolveRequiredToolNamesForTurn } from "./requiredToolNamesParser.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";

test("lineDescribesConfirmationExclusiveTools is segment-agnostic", () => {
  assert.equal(
    lineDescribesConfirmationExclusiveTools("| Step 2 | sim | só `crm_validate_cart` |"),
    true,
  );
  assert.equal(
    lineDescribesConfirmationExclusiveTools("| N=1 → S9 | só `embratur-reference` |"),
    true,
  );
  assert.equal(
    lineDescribesConfirmationExclusiveTools("PROIBIDO `foo` + `bar` no mesmo turno"),
    false,
  );
});

test("isLikelyMutableOrCompletionTool detects retail submit", () => {
  assert.equal(isLikelyMutableOrCompletionTool("crm_submit_order"), true);
  assert.equal(isLikelyMutableOrCompletionTool("loja_finalizar_pedido"), true);
  assert.equal(isLikelyMutableOrCompletionTool("crm_lookup_customer"), false);
});

test("isLikelyUploadOrMediaTool detects generic upload names", () => {
  assert.equal(isLikelyUploadOrMediaTool("checkin_upload_selfie"), true);
  assert.equal(isLikelyUploadOrMediaTool("retail_upload_receipt"), true);
  assert.equal(isLikelyUploadOrMediaTool("crm_lookup_customer"), false);
});

test("shouldExcludeCompletionToolFromRequired on form turns", () => {
  assert.equal(
    shouldExcludeCompletionToolFromRequired(
      "structured_form_submission",
      "crm_submit_order",
      ["crm_submit_order"],
    ),
    true,
  );
  assert.equal(
    shouldExcludeCompletionToolFromRequired("checkin_or_reservation", "hotel_check_in", []),
    false,
  );
  assert.equal(
    shouldExcludeCompletionToolFromRequired(
      "structured_form_submission",
      "audaar_consultar_main_guest",
      [],
    ),
    true,
  );
  assert.equal(
    shouldExcludeCompletionToolFromRequired("structured_form_submission", "main_guest", []),
    true,
    "bare main_guest alias must be treated as lookup on C9",
  );
  assert.equal(
    shouldExcludeCompletionToolFromRequired("structured_form_submission", "embratur-reference", []),
    true,
  );
});

test("retail: sim blocks submit until prerequisite satisfied", () => {
  const playbook = `
Proibido \`crm_validate_cart\` + \`crm_submit_order\` no mesmo turno.
| Confirm | sim | só \`crm_validate_cart\` |
| Final | concluído | Chame \`crm_submit_order\` |
`;
  const pending = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "sim" },
  );
  assert.ok(pending.exclusiveAllowedTools?.some((t) => t.includes("validate_cart")));
  assert.ok(turnPolicyPreExecBlockReason("crm_submit_order", pending));

  const after = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    {
      userMessage: "sim",
      priorToolOutcomes: [{ name: "crm_validate_cart", ok: true }],
    },
  );
  assert.equal(after.exclusiveAllowedTools, null);
  assert.equal(turnPolicyPreExecBlockReason("crm_submit_order", after), null);

  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    userMessage: "sim",
    priorToolOutcomes: [{ name: "crm_validate_cart", ok: true }],
    sessionPriorOutcomes: [{ name: "crm_validate_cart", ok: true }],
    flowSlots: { __completionReady: true, __awaitingPostGateData: false },
    lastAssistantMessage: "Confirme os dados da ficha / pedido. Está tudo certo?",
  });
  assert.ok(plan.requiredToolNames.some((t) => t.includes("submit_order")));
});

test("retail: form submission does not require submit in same turn", () => {
  const playbook = `
| Form | dados do cliente | formulário multi-campo | Chame \`crm_save_customer_form\` |
| Final | concluído | Chame \`crm_submit_order\` |
`;
  const names = resolveRequiredToolNamesForTurn(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    {
      userMessage:
        "* Nome: Ana\n* Email: ana@test.com\n* Telefone: 11999999999\n* Endereço: Rua 1",
    },
  );
  assert.ok(names.some((n) => n.includes("save_customer")));
  assert.equal(names.some((n) => n.includes("submit_order")), false);
});

test("omit-when-slots never drops lookup tools for documentNumber", () => {
  const playbook = `
| C8 | Se documentNumber já existe | Chame \`audaar_consultar_main_guest\` · PROIBIDO \`checkin_upload_selfie\` |
`;
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "41026299802" },
  );
  assert.equal(
    policy.omitToolsWhenSlotsPresent.some((r) =>
      r.tools.some((t) => /main_guest|consultar/i.test(t)),
    ),
    false,
  );
});
