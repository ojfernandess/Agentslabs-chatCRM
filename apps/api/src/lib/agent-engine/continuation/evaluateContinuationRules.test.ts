import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContinuationSyntheticBody,
  parseContinuationSyntheticBody,
} from "./constants.js";
import { matchAgentContinuationRules } from "./evaluateContinuationRules.js";
import { parseAgentContinuationConfig } from "./parseContinuationConfig.js";
import { AUDA_POST_CHECKIN_PASSO8_RULE } from "./templates.js";

test("parseContinuationSyntheticBody round-trip", () => {
  const body = buildContinuationSyntheticBody("post_checkin_passo8", "Execute Passo 8 agora.");
  const parsed = parseContinuationSyntheticBody(body);
  assert.equal(parsed?.ruleId, "post_checkin_passo8");
  assert.equal(parsed?.turnHint, "Execute Passo 8 agora.");
});

test("parseAgentContinuationConfig validates rules", () => {
  const ok = parseAgentContinuationConfig({
    enabled: true,
    rules: [AUDA_POST_CHECKIN_PASSO8_RULE],
  });
  assert.ok(ok?.rules?.length === 1);
  assert.equal(ok?.rules?.[0]?.id, "post_checkin_passo8");

  const bad = parseAgentContinuationConfig({ enabled: true, rules: [{ id: "x" }] });
  assert.equal(bad, null);
});

test("matchAgentContinuationRules after check-in success", () => {
  const matched = matchAgentContinuationRules({
    rules: [AUDA_POST_CHECKIN_PASSO8_RULE],
    trigger: "after_reply",
    ctx: {
      userMessage: "Sim",
      replyText: "Seu check-in foi concluído com sucesso! Em seguida envio os detalhes da sua estadia.",
      toolRound: {
        tools: [{ name: "audaar_check_in", ok: true, preview: "ok" }],
        resultDeliveredToCustomer: true,
      },
    },
    continuationCounts: {},
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.id, "post_checkin_passo8");
});

test("matchAgentContinuationRules respects maxPerConversation", () => {
  const matched = matchAgentContinuationRules({
    rules: [AUDA_POST_CHECKIN_PASSO8_RULE],
    trigger: "after_reply",
    ctx: {
      userMessage: "Sim",
      replyText: "Seu check-in foi concluído com sucesso!",
      toolRound: {
        tools: [{ name: "audaar_check_in", ok: true, preview: "ok" }],
        resultDeliveredToCustomer: true,
      },
    },
    continuationCounts: { post_checkin_passo8: 1 },
  });
  assert.equal(matched.length, 0);
});

test("matchAgentContinuationRules skips when pending", () => {
  const matched = matchAgentContinuationRules({
    rules: [AUDA_POST_CHECKIN_PASSO8_RULE],
    trigger: "after_reply",
    ctx: {
      userMessage: "Sim",
      replyText: "ok",
      toolRound: {
        tools: [{ name: "audaar_check_in", ok: true, preview: "ok" }],
        resultDeliveredToCustomer: true,
      },
    },
    continuationCounts: {},
    pendingRuleId: "post_checkin_passo8",
  });
  assert.equal(matched.length, 0);
});
