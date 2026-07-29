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
  buildPostGateSafeFallbackReply,
  confirmationGateSatisfiedThisTurn,
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
  // S9 pendente: check-in / upload NÃO podem correr — ficam para S10 / ficha
  assert.ok(turnPolicyPreExecBlockReason("audaar_check_in", policy));
  assert.ok(turnPolicyPreExecBlockReason("checkin_upload_documento", policy));
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
  assert.ok(turnPolicyPreExecBlockReason("audaar_check_in", policy));
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
  // On exclusive S9 ("sim"), check_in is blocked by category first; pair message applies when exclusive is unset.
  const blocked = turnPolicyPreExecBlockReasonForTurn(
    "audaar_check_in",
    ["embratur-reference"],
    policy,
  );
  assert.ok(blocked && /(proibid|fora da categoria)/i.test(blocked));
  const pairOnly = turnPolicyPreExecBlockReasonForTurn(
    "audaar_check_in",
    ["embratur-reference"],
    { ...policy, exclusiveAllowedTools: null },
  );
  assert.ok(pairOnly && /proibid/i.test(pairOnly));
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
    catalogToolNames: [
      "embratur-reference",
      "audaar_check_in",
      "audaar_consultar_main_guest",
      "listar_equipas",
      "transfer_to_team",
    ],
  });
  assert.ok(
    toolNameMatchesOmitAlias("audaar_check_in", omit),
    `expected check_in omitted when S9 pending, got ${JSON.stringify(omit)}`,
  );
  assert.ok(toolNameMatchesOmitAlias("audaar_consultar_main_guest", omit));
  assert.ok(toolNameMatchesOmitAlias("listar_equipas", omit));
  assert.equal(
    toolNameMatchesOmitAlias("embratur-reference", omit),
    false,
    "prerequisite tool must remain available",
  );
});

test("toolAliasesToOmitFromCatalog empties catalog when exclusive gate already ran", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.ok(policy.exclusiveAllowedTools?.length);
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: ["embratur-reference"],
    catalogToolNames: ["embratur-reference", "audaar_check_in", "listar_equipas", "buscar_conhecimento"],
  });
  assert.ok(toolNameMatchesOmitAlias("embratur-reference", omit));
  assert.ok(toolNameMatchesOmitAlias("audaar_check_in", omit));
  assert.ok(toolNameMatchesOmitAlias("listar_equipas", omit));
});

test("buildPostGateSafeFallbackReply and confirmationGateSatisfiedThisTurn", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.equal(
    confirmationGateSatisfiedThisTurn(policy, [{ name: "embratur-reference", ok: true }]),
    true,
  );
  assert.equal(
    confirmationGateSatisfiedThisTurn(policy, [{ name: "embratur-reference", ok: false }]),
    false,
  );
  const reply = buildPostGateSafeFallbackReply({
    gateToolNames: policy.confirmationPrerequisiteTools,
  });
  assert.ok(reply.length > 40);
  assert.match(reply, /dados|formul/i);
});

test("parseExclusiveToolsForConfirmationTurn ignores slot/language backticks", () => {
  const playbook = `
| C11 titular OK · N=1 → S9 | Sim → só \`embratur-reference\` · só \`mainGuestId\` · só \`brasileiro\` · só \`buscar_conhecimento\` · só \`audaar_consultar_reserva\` |
`;
  const exclusive = parseExclusiveToolsForConfirmationTurn(playbook);
  assert.deepEqual(exclusive, ["embratur-reference"]);
});

test("resolveTurnPolicy sim guest confirm requires only gate tool not fake names", () => {
  const playbook = `
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
| N=1 → S9 | só \`embratur-reference\` | só \`mainGuestId\` | só \`brasileiro\` |
| S10 | concluído | Chame \`audaar_check_in\` |
`;
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    {
      userMessage: "Sim",
      availableToolNames: [
        "embratur-reference",
        "audaar_check_in",
        "audaar_consultar_reserva",
        "buscar_conhecimento",
      ],
    },
  );
  assert.deepEqual(policy.exclusiveAllowedTools, ["embratur-reference"]);
  assert.equal(policy.confirmationPrerequisiteTools.includes("mainguestid"), false);
  assert.equal(policy.confirmationPrerequisiteTools.includes("brasileiro"), false);

  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    userMessage: "Sim",
    availableToolNames: [
      "embratur-reference",
      "audaar_check_in",
      "audaar_consultar_reserva",
      "buscar_conhecimento",
    ],
  });
  assert.deepEqual(plan.requiredToolNames, ["embratur-reference"]);
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

test("buildExecutionTurnPlan allows S10 on sim after embratur only when completion-ready", () => {
  const behavior = { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } };
  const blocked = buildExecutionTurnPlan({
    behaviorConfig: behavior,
    userMessage: "sim",
    priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
    sessionPriorOutcomes: [{ name: "embratur-reference", ok: true }],
    flowSlots: { __awaitingPostGateData: true, __completionReady: false },
  });
  assert.equal(blocked.turnPolicy.exclusiveAllowedTools, null);
  assert.equal(
    blocked.requiredToolNames.some((t) => /check[_-]?in/i.test(t)),
    false,
    `post-gate collect must not require check_in, got ${JSON.stringify(blocked.requiredToolNames)}`,
  );

  const ready = buildExecutionTurnPlan({
    behaviorConfig: behavior,
    userMessage: "sim",
    priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
    sessionPriorOutcomes: [{ name: "embratur-reference", ok: true }],
    flowSlots: { __awaitingPostGateData: false, __completionReady: true },
    availableToolNames: ["embratur-reference", "audaar_check_in"],
  });
  assert.ok(
    ready.requiredToolNames.some((t) => /check[_-]?in/i.test(t)),
    `expected check_in when completion-ready, got ${JSON.stringify(ready.requiredToolNames)}`,
  );
});

test("buildExecutionTurnPlan does not promote completion mid-turn after exclusive gate", () => {
  const playbook = `
| N=1 → S9 | só \`embratur-reference\` |
| S10 | concluído | Chame \`audaar_check_in\` |
`;
  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    userMessage: "Sim",
    priorToolOutcomes: [{ name: "embratur-reference", ok: true }],
    sessionPriorOutcomes: [],
    freezeCompletionPromotion: true,
    availableToolNames: ["embratur-reference", "audaar_check_in"],
  });
  assert.equal(
    plan.requiredToolNames.some((t) => /check[_-]?in/i.test(t)),
    false,
    `freeze must block check_in, got ${JSON.stringify(plan.requiredToolNames)}`,
  );
});

test("completionToolHints exclude playbook step labels like s-check-in", () => {
  const playbook = `
| S10 | concluído | Chame \`audaar_check_in\` · \`s-check-in\` |
`;
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    {
      userMessage: "sim",
      availableToolNames: ["audaar_check_in", "embratur-reference"],
    },
  );
  assert.ok(policy.completionToolHints.includes("audaar_check_in"));
  assert.equal(policy.completionToolHints.includes("s-check-in"), false);
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
    playbookText: playbook,
    catalogToolNames: ["checkin_upload_selfie", "checkin_upload_documento"],
  });
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_selfie", omit));
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_documento", omit));
});

test("toolAliasesToOmitFromCatalog defaults omit uploads when photo slots present without playbook rule", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "olá" },
  );
  assert.equal(policy.omitToolsWhenSlotsPresent.length, 0);
  const omit = toolAliasesToOmitFromCatalog({
    policy,
    existingToolNames: [],
    flowSlots: { profilePhotoId: 208493, documentPhotoId: 208494 },
    playbookText: SAMPLE_PLAYBOOK,
    catalogToolNames: ["checkin_upload_documento", "checkin_upload_selfie", "audaar_check_in"],
  });
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_documento", omit));
  assert.ok(toolNameMatchesOmitAlias("checkin_upload_selfie", omit));
});

test("validateToolOutcomesAgainstTurnPolicy flags check_in during exclusive S9", () => {
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    { userMessage: "sim" },
  );
  assert.ok(policy.exclusiveAllowedTools?.length);
  const alerts = validateToolOutcomesAgainstTurnPolicy(
    [
      { name: "embratur-reference", ok: true },
      { name: "audaar_check_in", ok: true },
    ],
    policy,
  );
  assert.ok(alerts.some((a) => /fora da categoria|proibid/i.test(a)));
});
