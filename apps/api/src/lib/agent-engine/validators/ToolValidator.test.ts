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

test("validateToolExecution ignores superseded failure when same tool later succeeds", () => {
  const result = validateToolExecution({
    toolOutcomes: [
      { name: "audaar_check_in", ok: false, preview: '{"ok":false,"error":"schema_validation_failed"}' },
      { name: "audaar_check_in", ok: true, preview: '{"ok":true,"statusCode":200}' },
    ],
    replyText:
      "Check-in concluído com sucesso. A sua reserva está confirmada e pronta para a sua chegada.",
    strictMode: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.blockSend, false);
  assert.equal(
    result.alerts.some((a) => /retornou erro/i.test(a)),
    false,
  );
});

test("validateToolExecution still flags unresolved tool failure", () => {
  const result = validateToolExecution({
    toolOutcomes: [
      { name: "audaar_check_in", ok: false, preview: '{"ok":false,"error":"http_500"}' },
    ],
    replyText: "Não consegui concluir o check-in neste momento.",
    strictMode: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockSend, true);
  assert.ok(result.alerts.some((a) => /retornou erro.*audaar_check_in/i.test(a)));
});
