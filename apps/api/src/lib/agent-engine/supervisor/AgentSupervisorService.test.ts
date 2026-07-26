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
