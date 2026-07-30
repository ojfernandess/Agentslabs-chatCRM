import assert from "node:assert/strict";
import test from "node:test";
import {
  isPostCompletionFollowUpMessage,
  POST_COMPLETION_FOLLOWUP_MAX_ACK_CHARS,
  POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX,
  resolvePostCompletionFollowUpSyntheticText,
  shouldSchedulePostCompletionFollowUp,
} from "./postCompletionFollowUp.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";

const playbookBehavior = {
  promptBuilder: {
    useFullPrompt: true,
    userCore: `
### S10 — check-in
Chame audaar_check_in
### S11 / Passo 8
audaar_consultar_reserva + buscar_conhecimento
`,
  },
};

test("parseAgentEngineConfig defaults postCompletionFollowUpEnabled to false", () => {
  const cfg = parseAgentEngineConfig({});
  assert.equal(cfg.postCompletionFollowUpEnabled, false);
  assert.equal(cfg.postCompletionFollowUpSyntheticText, "envie os detalhes da estadia");
});

test("parseAgentEngineConfig reads postCompletionFollowUpEnabled", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: {
      postCompletionFollowUpEnabled: true,
      postCompletionFollowUpSyntheticText: "ok, pode enviar",
    },
  });
  assert.equal(cfg.postCompletionFollowUpEnabled, true);
  assert.equal(cfg.postCompletionFollowUpSyntheticText, "ok, pode enviar");
});

test("shouldSchedulePostCompletionFollowUp requires flag + completion tool + short ack", () => {
  const base = {
    replyText: "Seu check-in foi concluído com sucesso! Em seguida envio os detalhes.",
    toolOutcomes: [{ name: "audaar_check_in", ok: true }],
    behaviorConfig: playbookBehavior,
    userMessage: "sim",
  };
  assert.equal(
    shouldSchedulePostCompletionFollowUp({ ...base, enabled: false }),
    false,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({ ...base, enabled: true }),
    true,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: true,
      toolOutcomes: [{ name: "audaar_check_in", ok: false }],
    }),
    false,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: true,
      toolOutcomes: [],
    }),
    false,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: true,
      replyText: "x".repeat(POST_COMPLETION_FOLLOWUP_MAX_ACK_CHARS + 1),
    }),
    false,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: true,
      skip: true,
    }),
    false,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: true,
      isFollowUpMessage: true,
    }),
    false,
  );
});

test("isPostCompletionFollowUpMessage detects synthetic provider id", () => {
  assert.equal(
    isPostCompletionFollowUpMessage({
      providerMsgId: `${POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX}abc`,
    }),
    true,
  );
  assert.equal(isPostCompletionFollowUpMessage({ providerMsgId: "wamid.xxx" }), false);
  assert.equal(isPostCompletionFollowUpMessage({}), false);
});

test("resolvePostCompletionFollowUpSyntheticText uses config or default", () => {
  assert.equal(
    resolvePostCompletionFollowUpSyntheticText({}),
    "envie os detalhes da estadia",
  );
  assert.equal(
    resolvePostCompletionFollowUpSyntheticText({
      agentEngine: { postCompletionFollowUpSyntheticText: "  pode seguir  " },
    }),
    "pode seguir",
  );
});
