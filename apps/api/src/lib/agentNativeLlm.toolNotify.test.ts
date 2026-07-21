import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSubstantiveAgentReplyToCustomer,
  parseToolCallNotifyFromBehavior,
  parseToolCallOutcomeFromJson,
  shouldEnsureToolResultFollowUp,
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
