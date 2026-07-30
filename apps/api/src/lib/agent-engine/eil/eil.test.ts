import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapabilityGraph,
  buildEilSnapshot,
  buildExecutionIntelligencePlan,
  detectReplyActions,
  evaluatePolicies,
  extractFactsFromToolResult,
  factsFromFlowSlots,
  ingestToolOutcomes,
  mergeFactStores,
  resolveForbiddenActions,
} from "./index.js";

test("CapabilityGraph indexes produces and capabilities", () => {
  const graph = buildCapabilityGraph({
    tools: [
      {
        name: "consultar_reserva",
        config: {
          eil: {
            produces: ["guestsQuantity", "reservationStatus"],
            capabilities: ["lookup_reservation"],
            factPaths: { guestsQuantity: "stay.guestsQuantity" },
          },
        },
      },
    ],
  });
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.producersByFact.guestsQuantity, ["consultar_reserva"]);
  assert.deepEqual(graph.toolsByCapability.lookup_reservation, ["consultar_reserva"]);
});

test("FactsEngine extracts via factPaths", () => {
  const graph = buildCapabilityGraph({
    tools: [
      {
        name: "consultar_reserva",
        config: {
          eil: {
            produces: ["guestsQuantity"],
            factPaths: { guestsQuantity: "stay.guestsQuantity" },
          },
        },
      },
    ],
  });
  const facts = extractFactsFromToolResult({
    toolName: "consultar_reserva",
    ok: true,
    structuredPayload: { stay: { guestsQuantity: 1 }, reservationStatus: "confirmed" },
    graph,
  });
  assert.equal(facts.guestsQuantity?.value, 1);
});

test("FactsEngine auto-discovers scalar status/quantity keys", () => {
  const facts = extractFactsFromToolResult({
    toolName: "pay_lookup",
    ok: true,
    structuredPayload: { paymentStatus: "paid", amount: 10, nested: { junk: true } },
  });
  assert.equal(facts.paymentStatus?.value, "paid");
});

test("merge flowSlots into facts", () => {
  const store = mergeFactStores(factsFromFlowSlots({ localizadorOuReservationId: "ABC" }));
  assert.equal(store.localizadorOuReservationId?.value, "ABC");
});

test("PolicyEngine blocks request_additional_party when guestsQuantity <= 1", () => {
  const facts = {
    guestsQuantity: {
      key: "guestsQuantity",
      value: 1,
      source: "consultar_reserva",
    },
  };
  const violations = evaluatePolicies({
    policies: [
      {
        id: "party_requires_n_gt_1",
        action: "request_additional_party",
        requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      },
    ],
    facts,
    replyActions: ["request_additional_party"],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].policyId, "party_requires_n_gt_1");
});

test("PolicyEngine allows request_additional_party when guestsQuantity > 1", () => {
  const facts = {
    guestsQuantity: { key: "guestsQuantity", value: 2, source: "t" },
  };
  const violations = evaluatePolicies({
    policies: [
      {
        id: "party_requires_n_gt_1",
        action: "request_additional_party",
        requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      },
    ],
    facts,
    replyActions: ["request_additional_party"],
  });
  assert.equal(violations.length, 0);
});

test("detectReplyActions finds request_additional_party generically", () => {
  const actions = detectReplyActions(
    "Perfeito. Me envie de uma vez os dados do acompanhante:\n• Nome completo",
  );
  assert.ok(actions.includes("request_additional_party"));
});

test("resolveForbiddenActions lists unmet action policies", () => {
  const forbidden = resolveForbiddenActions(
    [
      {
        id: "p1",
        action: "request_additional_party",
        requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      },
    ],
    { guestsQuantity: { key: "guestsQuantity", value: 1 } },
  );
  assert.deepEqual(forbidden, ["request_additional_party"]);
});

test("buildExecutionIntelligencePlan respects eil.enabled flag", () => {
  const planOff = buildExecutionIntelligencePlan({
    behaviorConfig: {},
    userMessage: "hello",
  });
  assert.equal(planOff.eilEnabled, false);

  const planOn = buildExecutionIntelligencePlan({
    behaviorConfig: {
      eil: {
        policies: [
          {
            id: "p1",
            action: "request_additional_party",
            requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
          },
        ],
      },
    },
    userMessage: "sim",
    facts: { guestsQuantity: { key: "guestsQuantity", value: 1 } },
  });
  assert.equal(planOn.eilEnabled, true);
  assert.ok(planOn.forbiddenActions.includes("request_additional_party"));
  assert.deepEqual(planOn.policyIds, ["p1"]);
});

test("ingestToolOutcomes + snapshot detects constraint violation on reply", () => {
  const graph = buildCapabilityGraph({
    tools: [
      {
        name: "consultar_reserva",
        config: {
          eil: {
            produces: ["guestsQuantity"],
            factPaths: { guestsQuantity: "stay.guestsQuantity" },
          },
        },
      },
    ],
  });
  const facts = ingestToolOutcomes({
    outcomes: [
      {
        name: "consultar_reserva",
        ok: true,
        structuredPayload: { stay: { guestsQuantity: 1 } },
      },
    ],
    graph,
  });
  const behaviorConfig = {
    eil: {
      policies: [
        {
          id: "party_requires_n_gt_1",
          action: "request_additional_party",
          requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
        },
      ],
    },
  };
  const plan = buildExecutionIntelligencePlan({
    behaviorConfig,
    userMessage: "Sim",
    facts,
    graph,
    toolsCalled: ["consultar_reserva"],
  });
  const snap = buildEilSnapshot({
    behaviorConfig,
    plan,
    facts,
    graph,
    toolsCalled: ["consultar_reserva"],
    replyText: "Me envie os dados do acompanhante",
  });
  assert.equal(snap.violations.length, 1);
  assert.ok(snap.replyActions.includes("request_additional_party"));
});

const TITULAR_PLAYBOOK = `
| N=1 → S9 | só \`embratur-reference\` | reference |
| S10 | Chame \`audaar_check_in\` | check-in |
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
`;

test("buildExecutionIntelligencePlan suppresses embratur on titular Sim N≥2", () => {
  const titular =
    "Confirme os dados do TITULAR. Está tudo certo?\n• Nome: Ana";
  const withoutCtx = buildExecutionIntelligencePlan({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: TITULAR_PLAYBOOK },
      eil: { policies: [] },
    },
    userMessage: "sim",
    availableToolNames: ["embratur-reference", "audaar_check_in"],
  });
  assert.ok(
    withoutCtx.requiredToolNames.some((t) => /embratur|reference/i.test(t)),
    "sem contexto ainda exige embratur",
  );

  const withCtx = buildExecutionIntelligencePlan({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: TITULAR_PLAYBOOK },
      eil: { policies: [] },
    },
    userMessage: "sim",
    availableToolNames: ["embratur-reference", "audaar_check_in"],
    flowSlots: { guestsQuantity: 2, __lastAssistantPreview: titular },
    lastAssistantMessage: titular,
    memory: { flowSlots: { guestsQuantity: 2 } },
    priorToolOutcomes: [],
    sessionPriorOutcomes: [],
  });
  assert.equal(withCtx.turnPolicy.exclusiveAllowedTools, null);
  assert.equal(
    withCtx.requiredToolNames.some((t) => /embratur|check[_-]?in/i.test(t)),
    false,
    `titular N≥2 must require ZERO gate tools, got ${JSON.stringify(withCtx.requiredToolNames)}`,
  );
  assert.equal(withCtx.pendingTools.length, 0);
});
