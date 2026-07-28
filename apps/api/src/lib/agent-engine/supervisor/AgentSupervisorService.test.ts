import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
} from "./AgentSupervisorService.js";

test("buildSupervisorTrace detects ignored knowledge query in strict mode", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Quais as categorias de quartos do hotel Brooklin?",
    replyText: "Só um momento, vou verificar.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    kbQueryLikely: true,
  });
  const trace = buildSupervisorTrace(input);
  const knowledge = trace.checks.find((c) => c.id === "knowledge_used");
  assert.ok(knowledge);
  assert.equal(knowledge!.passed, false);
  assert.equal(trace.approved, false);
});

test("buildSupervisorTrace passes when KB covers query", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Quais as categorias de quartos?",
    replyText: "Temos Standard, Duplo e Quadruplo.",
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}' }],
    kbMeta: { hasUsefulExcerpts: true, coversQuery: true },
    strictMode: true,
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(trace.approved, true);
});

test("buildSupervisorTrace detects execution loop on duplicate reply", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Qual o WiFi?",
    replyText: "Aguarde um instante.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    retryCount: 1,
    previousReply: "Aguarde um instante.",
  });
  const trace = buildSupervisorTrace(input);
  const loop = trace.checks.find((c) => c.id === "no_execution_loop");
  assert.ok(loop);
  assert.equal(loop!.passed, false);
});

test("shouldRetryAfterSupervisor retries knowledge failures in strict mode", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Qual o endereço?",
    replyText: "Vou verificar.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    kbQueryLikely: true,
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(shouldRetryAfterSupervisor(trace, true, 0), true);
  assert.equal(shouldRetryAfterSupervisor(trace, true, 2), false);
});

test("buildSupervisorTrace includes llm supervisor when provided", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Olá",
    replyText: "Bom dia, como posso ajudar?",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: false,
    llmApproved: false,
    llmSummary: "Resposta genérica",
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(trace.approved, false);
  assert.ok(trace.checks.some((c) => c.id === "llm_supervisor" && !c.passed));
});

test("buildSupervisorTrace fails when execution contract has pending required tools", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "check-in ABC12345",
    replyText: "A sua reserva está confirmada.",
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: "ok" }],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    executionContract: {
      version: 1,
      turnId: "t1",
      userMessage: "check-in ABC12345",
      objective: "consultar reserva",
      planPhase: "tooling",
      requiredToolNames: ["audaar_consultar_reserva"],
      forbiddenToolNames: [],
      pendingToolNames: ["audaar_consultar_reserva"],
      satisfiedToolNames: [],
      requiredFacts: [],
      existingFacts: [],
      constraints: [],
      completionCriteria: [],
      valid: false,
      violations: ["required_tool_missing:audaar_consultar_reserva"],
    },
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(trace.checks.find((c) => c.id === "execution_contract_valid")?.passed, false);
  assert.equal(trace.checks.find((c) => c.id === "required_tools_contract")?.passed, false);
  assert.equal(trace.approved, false);
});

test("EIL constraints fail supervisor when violations present", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Sim",
    replyText: "Me envie os dados do acompanhante",
    toolOutcomes: [{ name: "consultar_reserva", ok: true, preview: '{"guestsQuantity":1}' }],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    eilEnabled: true,
    eilPlan: {
      userMessage: "Sim",
      requiredToolNames: [],
      turnPolicy: { forbiddenSameTurnPairs: [], exclusiveAllowedTools: null, completionToolHints: [], blockEscalation: false },
      knowledgeSeeking: false,
      matchedPatternIds: [],
      requiredFacts: [],
      knownFactKeys: ["guestsQuantity"],
      pendingFacts: [],
      pendingTools: [],
      pendingCapabilities: [],
      forbiddenActions: ["request_additional_party"],
      policyIds: ["party_requires_n_gt_1"],
      eilEnabled: true,
    },
    eilViolations: [
      {
        policyId: "party_requires_n_gt_1",
        action: "request_additional_party",
        reason: "unmet",
        predicates: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      },
    ],
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(trace.checks.find((c) => c.id === "eil_constraints")?.passed, false);
  assert.equal(trace.approved, false);
  assert.equal(shouldRetryAfterSupervisor(trace, true, 0), true);
});

test("EIL checks are no-op when eilEnabled is false", () => {
  const input = buildSupervisorValidationInput({
    userMessage: "Sim",
    replyText: "Me envie os dados do acompanhante",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    strictMode: true,
    eilEnabled: false,
    eilViolations: [
      {
        policyId: "x",
        action: "request_additional_party",
        reason: "unmet",
        predicates: [],
      },
    ],
  });
  const trace = buildSupervisorTrace(input);
  assert.equal(trace.checks.find((c) => c.id === "eil_constraints")?.passed, true);
});
