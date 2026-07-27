import assert from "node:assert/strict";
import test from "node:test";
import {
  parseForbiddenSameTurnPairsFromPlaybook,
  parseExclusiveToolsForConfirmationTurn,
  resolveTurnPolicy,
  validateToolOutcomesAgainstTurnPolicy,
  shouldUseReplyOnlyRetry,
  findForbiddenPairViolation,
  turnPolicyPreExecBlockReason,
} from "./turnPolicyParser.js";
import { validateToolExecution } from "./ToolValidator.js";

const SAMPLE_PLAYBOOK = `
## Regras
**Proibido** misturar categorias no mesmo turno (ex.: lookup + Embratur · reference + check-in).
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
**Proibido** \`loja_consultar_cliente\` + \`loja_finalizar_pedido\` no mesmo turno

| Passo | Acção | Tools |
| N=1 → S9 | só \`embratur-reference\` | reference |
| S10 | Chame \`audaar_check_in\` | check-in |
`;

test("parseForbiddenSameTurnPairsFromPlaybook extracts backtick pairs", () => {
  const pairs = parseForbiddenSameTurnPairsFromPlaybook(SAMPLE_PLAYBOOK);
  assert.ok(
    findForbiddenPairViolation(["embratur-reference", "audaar_check_in"], pairs),
    `expected embratur+check_in pair, got ${JSON.stringify(pairs)}`,
  );
  assert.ok(
    findForbiddenPairViolation(["loja_consultar_cliente", "loja_finalizar_pedido"], pairs),
    `expected loja pair, got ${JSON.stringify(pairs)}`,
  );
});

test("parseForbiddenSameTurnPairsFromPlaybook extracts plus shorthand", () => {
  const pairs = parseForbiddenSameTurnPairsFromPlaybook(
    "Proibido misturar reference + check-in no mesmo turno",
  );
  assert.ok(pairs.length >= 1);
  assert.ok(findForbiddenPairViolation(["embratur-reference", "audaar_check_in"], pairs));
});

test("parseExclusiveToolsForConfirmationTurn excludes completion tools", () => {
  const exclusive = parseExclusiveToolsForConfirmationTurn(SAMPLE_PLAYBOOK);
  assert.ok(exclusive.some((t) => t.includes("embratur") || t.includes("reference")));
  assert.equal(
    exclusive.some((t) => /check_in/i.test(t)),
    false,
  );
});

test("parseExclusiveToolsForConfirmationTurn never includes escalation tools", () => {
  const playbook = `
| **C11 titular OK · N=1 → S9** | só \`embratur-reference\` | \`audaar_check_in\` · \`consultar_reserva\` · \`call_human\` · \`transfer_to_team\` · \`set_conversation_status\` |
**Certo N=1:** titular → \`sim\` → **só** \`embratur-reference\` + template 6.
**PROIBIDO:** \`call_human\` · \`transfer_to_team\`
`;
  const exclusive = parseExclusiveToolsForConfirmationTurn(playbook);
  assert.ok(exclusive.some((t) => /embratur|reference/i.test(t)));
  assert.equal(exclusive.some((t) => /call_human|transfer_to_team|set_conversation/i.test(t)), false);
  assert.equal(exclusive.some((t) => /consultar_reserva/i.test(t)), false);
});

test("turnPolicyPreExecBlockReason blocks transfer on sim", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(policy.blockEscalation, true);
  assert.ok(turnPolicyPreExecBlockReason("transfer_to_team", policy));
  assert.ok(turnPolicyPreExecBlockReason("call_human", policy));
  assert.ok(turnPolicyPreExecBlockReason("set_conversation_status", policy));
  assert.equal(turnPolicyPreExecBlockReason("embratur-reference", policy), null);
  // Ficha→sim→check_in não é hard-block por exclusividade S9
  assert.equal(turnPolicyPreExecBlockReason("audaar_check_in", policy), null);
});

test("blockEscalation alone blocks transfer even without exclusive tools", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: "Sem regras de só tool." } },
    { userMessage: "Sim" },
  );
  assert.equal(policy.blockEscalation, true);
  assert.ok(turnPolicyPreExecBlockReason("transfer_to_team", policy));
});

test("resolveTurnPolicy applies exclusive on sim", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.ok(policy.forbiddenSameTurnPairs.length >= 1);
  assert.ok(policy.exclusiveAllowedTools && policy.exclusiveAllowedTools.length >= 1);
});

test("validateToolOutcomesAgainstTurnPolicy blocks reference+check_in", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  const alerts = validateToolOutcomesAgainstTurnPolicy(
    [
      { name: "embratur-reference", ok: true },
      { name: "audaar_check_in", ok: true },
    ],
    policy,
  );
  assert.ok(alerts.some((a) => /proibid/i.test(a)));
});

test("validateToolExecution blocks forbidden pair in strict mode", () => {
  const result = validateToolExecution({
    toolOutcomes: [
      { name: "embratur-reference", ok: true, preview: "ok" },
      { name: "audaar_check_in", ok: true, preview: "ok" },
    ],
    replyText: "Seu check-in foi concluído.",
    strictMode: true,
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    userMessage: "sim",
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockSend, true);
  assert.ok(result.alerts.some((a) => /proibid|fora da categoria/i.test(a)));
});

test("shouldUseReplyOnlyRetry when tools succeeded and reply quality failed", () => {
  assert.equal(
    shouldUseReplyOnlyRetry({
      toolOutcomes: [{ name: "audaar_check_in", ok: true }],
      supervisorChecks: [
        { id: "prompt_coherent", passed: false },
        { id: "tool_used", passed: true },
      ],
    }),
    true,
  );
  assert.equal(
    shouldUseReplyOnlyRetry({
      toolOutcomes: [],
      supervisorChecks: [{ id: "prompt_coherent", passed: false }],
    }),
    false,
  );
});

test("retail segment: forbidden pair without hotel vocabulary", () => {
  const playbook = `
Proibido \`crm_lookup_customer\` + \`crm_submit_order\` no mesmo turno.
N=1 → S9 só \`crm_ask_preferences\`
`;
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "sim" },
  );
  const alerts = validateToolOutcomesAgainstTurnPolicy(
    [
      { name: "crm_lookup_customer", ok: true },
      { name: "crm_submit_order", ok: true },
    ],
    policy,
  );
  assert.ok(alerts.some((a) => /proibid/i.test(a)));
});

test("self-alias pair from C3 table does not block single consultar_reserva", () => {
  const playbook = `
| C3 | **Check-in explícito** | \`fazer check-in\` + localizador | Chame \`audaar_consultar_reserva\` · **PROIBIDO** \`buscar_conhecimento\` · PARE | consultar_reserva |
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
`;
  const pairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  assert.equal(
    findForbiddenPairViolation(["audaar_consultar_reserva"], pairs),
    null,
    `single reservation tool must not self-block, pairs=${JSON.stringify(pairs)}`,
  );
  assert.ok(
    findForbiddenPairViolation(["audaar_consultar_reserva", "buscar_conhecimento"], pairs) ||
      pairs.some((p) => /buscar_conhecimento|consultar_reserva|audaar/.test(p.a + p.b)),
  );
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "fazer check-in na reserva QP7ZVTOG" },
  );
  const alerts = validateToolOutcomesAgainstTurnPolicy(
    [{ name: "audaar_consultar_reserva", ok: true }],
    policy,
  );
  assert.equal(alerts.length, 0, `unexpected alerts: ${JSON.stringify(alerts)}`);
  assert.ok(
    findForbiddenPairViolation(["embratur-reference", "audaar_check_in"], policy.forbiddenSameTurnPairs),
  );
});

test("findForbiddenPairViolation requires two distinct tool invocations", () => {
  const pairs = [{ a: "foo_lookup", b: "lookup", source: "test" }];
  // Alias-of-self pair is ignored
  assert.equal(findForbiddenPairViolation(["foo_lookup"], pairs), null);
  const real = [{ a: "foo_lookup", b: "foo_submit", source: "test" }];
  assert.ok(findForbiddenPairViolation(["foo_lookup", "foo_submit"], real));
  assert.equal(findForbiddenPairViolation(["foo_lookup"], real), null);
});
