import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicReplyFromToolOutcomes,
  hasSubstantiveAgentReplyToCustomer,
  parseToolCallNotifyFromBehavior,
  parseToolCallOutcomeFromJson,
  shouldEnsureToolResultFollowUp,
  shouldForceDeliveryAfterTools,
} from "./agentNativeLlm.js";

test("parseToolCallNotifyFromBehavior reads ensureResultDelivered", () => {
  const cfg = parseToolCallNotifyFromBehavior({
    toolCallNotify: {
      enabled: true,
      message: "Aguarde",
      selectedTools: ["custom:abc"],
      ensureResultDelivered: true,
    },
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.ensureResultDelivered, true);
});

test("parseToolCallOutcomeFromJson extracts ok and preview", () => {
  const out = parseToolCallOutcomeFromJson(
    "oc_tool_test",
    JSON.stringify({ ok: true, bodyPreview: '{"message":"ok"}' }),
  );
  assert.equal(out.ok, true);
  assert.match(out.preview, /message/);
});

test("shouldEnsureToolResultFollowUp when reply is stall-only after monitored tools", () => {
  const outcomes = [
    { name: "oc_tool_a", ok: true, preview: "data", monitored: true },
    { name: "oc_tool_b", ok: false, preview: "fail", monitored: false },
  ];
  assert.equal(
    shouldEnsureToolResultFollowUp({
      ensureResultDelivered: true,
      toolOutcomes: outcomes,
      replyText: "Só um momento por gentileza",
    }),
    true,
  );
  assert.equal(
    shouldEnsureToolResultFollowUp({
      ensureResultDelivered: true,
      toolOutcomes: outcomes,
      replyText: "O seu check-in foi concluído com sucesso. Código: ABC123.",
    }),
    false,
  );
  assert.equal(hasSubstantiveAgentReplyToCustomer("O check-in foi concluído."), true);
});

test("shouldForceDeliveryAfterTools when empty or stall after any tools", () => {
  const outcomes = [{ name: "oc_tool_reserva", ok: true, preview: '{"found":true}', monitored: true }];
  assert.equal(shouldForceDeliveryAfterTools({ toolOutcomes: outcomes, replyText: "" }), true);
  assert.equal(
    shouldForceDeliveryAfterTools({ toolOutcomes: outcomes, replyText: "Só um momento por gentileza" }),
    true,
  );
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "Encontrei a sua reserva para amanhã.",
    }),
    false,
  );
  assert.equal(shouldForceDeliveryAfterTools({ toolOutcomes: [], replyText: "" }), false);
});

test("buildDeterministicReplyFromToolOutcomes uses tool preview when LLM fails", () => {
  const text = buildDeterministicReplyFromToolOutcomes([
    {
      name: "buscar_conhecimento",
      ok: true,
      preview: "kb noise",
      monitored: false,
    },
    {
      name: "oc_tool_consultar_reserva",
      ok: true,
      preview: JSON.stringify({ message: "Reserva confirmada para 22/07." }),
      monitored: true,
    },
  ]);
  assert.match(text, /Reserva confirmada/);
  assert.equal(hasSubstantiveAgentReplyToCustomer(text), true);
});
