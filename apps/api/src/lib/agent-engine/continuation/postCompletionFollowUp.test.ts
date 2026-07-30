import assert from "node:assert/strict";
import test from "node:test";
import {
  isPostCompletionFollowUpMessage,
  POST_COMPLETION_FOLLOWUP_MAX_ACK_CHARS,
  POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX,
  resolvePostCompletionFollowUpSyntheticText,
  shouldSchedulePostCompletionFollowUp,
  shouldSuppressOutboundCheckInAck,
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

test("shouldSchedulePostCompletionFollowUp schedules Passo 8 after check-in even if flag off", () => {
  const base = {
    replyText: "Seu check-in foi concluído com sucesso! Em seguida envio os detalhes.",
    toolOutcomes: [{ name: "audaar_check_in", ok: true }],
    behaviorConfig: playbookBehavior,
    userMessage: "sim",
  };
  // Check-in: always schedule Passo 8 (ack curto não é a mensagem ao hóspede).
  assert.equal(
    shouldSchedulePostCompletionFollowUp({ ...base, enabled: false }),
    true,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({ ...base, enabled: true }),
    true,
  );
  assert.equal(
    shouldSchedulePostCompletionFollowUp({
      ...base,
      enabled: false,
      replyText: "",
    }),
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

test("shouldSuppressOutboundCheckInAck hides short S10 ack when Passo 8 follows", () => {
  assert.equal(
    shouldSuppressOutboundCheckInAck({
      willFollowUp: true,
      replyText: "Seu check-in foi concluído com sucesso! Em seguida envio Wi-Fi, endereço e acessos da estadia.",
      toolOutcomes: [{ name: "audaar_check_in", ok: true }],
    }),
    true,
  );
  assert.equal(
    shouldSuppressOutboundCheckInAck({
      willFollowUp: false,
      replyText: "Seu check-in foi concluído com sucesso! Em seguida envio Wi-Fi, endereço e acessos da estadia.",
      toolOutcomes: [{ name: "audaar_check_in", ok: true }],
    }),
    false,
  );
  assert.equal(
    shouldSuppressOutboundCheckInAck({
      willFollowUp: true,
      replyText: "Seu check-in foi concluído!\n\n🏨 Nome: Hotel\nWi-Fi: …",
      toolOutcomes: [{ name: "audaar_check_in", ok: true }],
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
