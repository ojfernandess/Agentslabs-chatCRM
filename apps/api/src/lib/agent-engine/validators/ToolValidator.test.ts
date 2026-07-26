import assert from "node:assert/strict";
import test from "node:test";
import { validateToolExecution } from "./ToolValidator.js";

test("validateToolExecution flags missing required tool in strict mode", () => {
  const result = validateToolExecution({
    toolOutcomes: [],
    replyText: "Resposta sem ferramenta.",
    strictMode: true,
    requiredToolNames: ["buscar_conhecimento"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockSend, true);
  assert.ok(result.alerts.some((a) => a.includes("obrigatória")));
});

test("validateToolExecution passes when required tool invoked", () => {
  const result = validateToolExecution({
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}' }],
    replyText: "Temos quartos Standard e Deluxe.",
    strictMode: true,
    requiredToolNames: ["buscar_conhecimento"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockSend, false);
});

test("validateToolExecution blocks stall reply after successful tool in strict mode", () => {
  const result = validateToolExecution({
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: "ok" }],
    replyText: "Só um momento, vou verificar.",
    strictMode: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockSend, true);
});

test("validateToolExecution blocks empty reply after tool success", () => {
  const result = validateToolExecution({
    toolOutcomes: [{ name: "http_tool", ok: true, preview: "200 OK" }],
    replyText: "   ",
    strictMode: false,
  });
  assert.equal(result.blockSend, true);
});

test("validateToolExecution suggests fallback on tool failure", () => {
  const result = validateToolExecution({
    toolOutcomes: [{ name: "http_tool", ok: false, preview: "timeout" }],
    replyText: "Não consegui consultar agora.",
    strictMode: false,
  });
  assert.equal(result.fallbackSuggested, true);
  assert.ok(result.alerts.some((a) => a.includes("erro")));
});
