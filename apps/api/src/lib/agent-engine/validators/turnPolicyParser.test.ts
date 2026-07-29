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
  turnPolicyPreExecBlockReasonForTurn,
  formatTurnPolicyForSupervisor,
  toolAliasesToOmitFromCatalog,
  toolNameMatchesOmitAlias,
} from "./turnPolicyParser.js";
import { validateToolExecution } from "./ToolValidator.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";

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

test("resolveTurnPolicy on sim with pending S9 sets exclusive embratur", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.ok(policy.forbiddenSameTurnPairs.length >= 1);
  assert.equal(policy.blockEscalation, true);
  assert.ok(
    policy.exclusiveAllowedTools?.some((t) => /embratur|reference/i.test(t)),
    "expected exclusive S9 tool on sim when prerequisite not satisfied",
  );
  assert.equal(turnPolicyPreExecBlockReason("audaar_check_in", policy), null);
  assert.ok(turnPolicyPreExecBlockReason("transfer_to_team", policy));
});

test("resolveTurnPolicy on sim after embratur allows check_in path", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    {
      userMessage: "sim",
      priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
    },
  );
  assert.equal(policy.exclusiveAllowedTools, null);
  assert.equal(turnPolicyPreExecBlockReason("audaar_check_in", policy), null);
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

test("shouldUseReplyOnlyRetry on validation_passed failure does not re-run tools", () => {
  // HJ2XQZXO 17:33: transfer ilegal já executado → retry deve ser reply-only
  assert.equal(
    shouldUseReplyOnlyRetry({
      toolOutcomes: [
        { name: "embratur-reference", ok: true },
        { name: "transfer_to_team", ok: true },
      ],
      supervisorChecks: [
        { id: "validation_passed", passed: false },
        { id: "tool_used", passed: true },
        { id: "llm_supervisor", passed: true },
      ],
    }),
    true,
  );
  assert.equal(
    shouldUseReplyOnlyRetry({
      toolOutcomes: [{ name: "embratur-reference", ok: true }],
      supervisorChecks: [{ id: "tool_used", passed: false }],
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

test("turnPolicyPreExecBlockReasonForTurn blocks forbidden pair before second tool runs", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(turnPolicyPreExecBlockReasonForTurn("embratur-reference", [], policy), null);
  const blocked = turnPolicyPreExecBlockReasonForTurn(
    "audaar_check_in",
    ["embratur-reference"],
    policy,
  );
  assert.ok(blocked && /proibid/i.test(blocked));
});

test("formatTurnPolicyForSupervisor summarizes blockEscalation and pairs", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  const summary = formatTurnPolicyForSupervisor(policy);
  assert.match(summary, /Escalonamento BLOQUEADO/i);
  assert.match(summary, /Pares proibidos/i);
});

test("findForbiddenPairViolation requires two distinct tool invocations", () => {
  const pairs = [{ a: "foo_lookup", b: "lookup", source: "test" }];
  // Alias-of-self pair is ignored
  assert.equal(findForbiddenPairViolation(["foo_lookup"], pairs), null);
  const real = [{ a: "foo_lookup", b: "foo_submit", source: "test" }];
  assert.ok(findForbiddenPairViolation(["foo_lookup", "foo_submit"], real));
  assert.equal(findForbiddenPairViolation(["foo_lookup"], real), null);
});

test("toolAliasesToOmitFromCatalog omits complementary side after one tool ran", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "fazer check-in" },
  );
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: ["embratur-reference"],
  });
  assert.ok(
    omit.some((a) => toolNameMatchesOmitAlias("audaar_check_in", [a]) || /check.?in/i.test(a)),
    `expected check-in omit aliases, got ${JSON.stringify(omit)}`,
  );
});

test("toolAliasesToOmitFromCatalog on confirmation omits check_in when S9 pending", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(policy.blockEscalation, true);
  assert.ok(policy.completionToolHints.length > 0, "expected completion hints from S10");
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: [],
  });
  assert.ok(
    toolNameMatchesOmitAlias("audaar_check_in", omit),
    `expected check_in omitted when S9 pending, got ${JSON.stringify(omit)}`,
  );
  assert.equal(
    toolNameMatchesOmitAlias("embratur-reference", omit),
    false,
    "prerequisite tool must remain available",
  );
});

test("buildExecutionTurnPlan requires exclusive S9 on sim without prior embratur", () => {
  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    userMessage: "sim",
  });
  assert.ok(
    plan.requiredToolNames.some((t) => /embratur|reference/i.test(t)),
    `expected embratur in required, got ${JSON.stringify(plan.requiredToolNames)}`,
  );
  assert.equal(plan.turnPolicy.exclusiveAllowedTools?.length ?? 0, 1);
});

test("buildExecutionTurnPlan allows S10 on sim after embratur in session", () => {
  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    userMessage: "sim",
    priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
  });
  assert.equal(plan.turnPolicy.exclusiveAllowedTools, null);
  assert.equal(
    plan.requiredToolNames.some((t) => /embratur|reference/i.test(t)),
    false,
  );
  assert.ok(
    plan.requiredToolNames.some((t) => /check[_-]?in/i.test(t)),
    `expected check_in in required, got ${JSON.stringify(plan.requiredToolNames)}`,
  );
});

test("toolAliasesToOmitFromCatalog on confirmation omits embratur when S9 already satisfied", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    {
      userMessage: "sim",
      priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
    },
  );
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: [],
    priorToolNames: ["embratur-reference"],
  });
  assert.ok(
    toolNameMatchesOmitAlias("embratur-reference", omit),
    `expected embratur omitted after S9, got ${JSON.stringify(omit)}`,
  );
  assert.equal(
    toolNameMatchesOmitAlias("audaar_check_in", omit),
    false,
    "completion tool must remain available",
  );
});

test("toolAliasesToOmitFromCatalog omits tools when playbook slot preconditions met", () => {
  const playbook = `${SAMPLE_PLAYBOOK}
| C10 | Se profilePhotoId e documentPhotoId já existem | PROIBIDO \`checkin_upload_selfie\` \`checkin_upload_documento\` |
`;
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "sim" },
  );
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: [],
    flowSlots: { profilePhotoId: 123, documentPhotoId: 456 },
  });
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_selfie", omit));
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_documento", omit));
});
