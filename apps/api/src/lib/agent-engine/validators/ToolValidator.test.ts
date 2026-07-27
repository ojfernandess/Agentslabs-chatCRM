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

test("validateToolExecution accepts partial name match for HTTP tools", () => {
  const result = validateToolExecution({
    toolOutcomes: [{ name: "audaar_consultar_main_guest", ok: true, preview: '{"found":true}' }],
    replyText: "Encontrei seu cadastro anterior.",
    strictMode: true,
    requiredToolNames: ["consultar_main_guest"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockSend, false);
});
