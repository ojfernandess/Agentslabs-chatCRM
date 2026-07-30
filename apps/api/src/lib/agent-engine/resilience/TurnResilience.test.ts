import assert from "node:assert/strict";
import test from "node:test";
import {
  decideResilienceAction,
  parseResilienceConfig,
  DEFAULT_RESILIENCE_CONFIG,
} from "./TurnResilience.js";
import type { AgentSupervisorTrace } from "../types.js";
import type { ExecutionContract } from "../core/types.js";

function trace(failedIds: string[]): AgentSupervisorTrace {
  return {
    approved: false,
    summary: "failed",
    retryCount: 0,
    checks: [
      ...failedIds.map((id) => ({ id, label: id, passed: false })),
      { id: "ok_check", label: "ok", passed: true },
    ],
  };
}

const pendingContract: ExecutionContract = {
  version: 1,
  turnId: "t1",
  userMessage: "check-in ABC",
  objective: "lookup",
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
};

test("decideResilienceAction recovers mandatory tools once", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: true,
    supervisorTrace: trace(["required_tools_contract", "execution_contract_valid"]),
    executionContract: pendingContract,
    retryCount: 0,
    recoveryCount: 0,
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true }],
  });
  assert.equal(d.action, "recover_mandatory_tools");
  assert.deepEqual(d.pendingToolNames, ["audaar_consultar_reserva"]);
});

test("decideResilienceAction does not recover twice", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: true,
    supervisorTrace: trace(["required_tools_contract"]),
    executionContract: pendingContract,
    retryCount: 1,
    recoveryCount: 1,
    toolOutcomes: [],
  });
  assert.notEqual(d.action, "recover_mandatory_tools");
});

test("decideResilienceAction uses reply_only for quality failures with tools ok", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: true,
    supervisorTrace: trace(["prompt_coherent", "knowledge_used"]),
    executionContract: {
      ...pendingContract,
      pendingToolNames: [],
      satisfiedToolNames: ["audaar_consultar_reserva"],
      valid: true,
      violations: [],
    },
    retryCount: 0,
    recoveryCount: 0,
    toolOutcomes: [{ name: "audaar_consultar_reserva", ok: true }],
  });
  assert.equal(d.action, "reply_only_retry");
});

test("decideResilienceAction detects validation loop and applies fallback", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: true,
    supervisorTrace: trace(["prompt_coherent"]),
    executionContract: { ...pendingContract, pendingToolNames: [], valid: true, violations: [] },
    retryCount: 1,
    recoveryCount: 0,
    previousReply: "Só um momento.",
    replyText: "Só um momento.",
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true }],
  });
  assert.equal(d.action, "apply_fallback");
  assert.equal(d.reason, "validation_loop_detected");
  assert.ok(d.fallbackMessage);
});

test("decideResilienceAction is no-op when disabled", () => {
  const d = decideResilienceAction({
    config: DEFAULT_RESILIENCE_CONFIG,
    strictMode: true,
    supervisorTrace: trace(["required_tools_contract"]),
    executionContract: pendingContract,
    retryCount: 0,
    recoveryCount: 0,
  });
  assert.equal(d.action, "continue");
});

test("decideResilienceAction ignores stale eil_plan_followed when Engine contract is satisfied", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: true,
    supervisorTrace: trace(["eil_plan_followed"]),
    executionContract: {
      ...pendingContract,
      pendingToolNames: [],
      requiredToolNames: [],
      satisfiedToolNames: [],
      valid: true,
      violations: [],
      planPhase: "reply",
    },
    retryCount: 0,
    recoveryCount: 0,
    toolOutcomes: [],
  });
  assert.equal(d.action, "continue");
  assert.equal(d.reason, "engine_contract_satisfied_ignore_stale_eil");
});

test("parseResilienceConfig reads engine flag and custom message", () => {
  const cfg = parseResilienceConfig(
    { resilienceEnabled: true } as never,
    {
      agentEngine: {
        blockedFallbackMessage: "Mensagem custom.",
        maxMandatoryRecoveries: 2,
      },
    },
  );
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.blockedFallbackMessage, "Mensagem custom.");
  assert.equal(cfg.maxMandatoryRecoveries, 2);
});

test("decideResilienceAction applies fallback on completion_claim without strict mode", () => {
  const d = decideResilienceAction({
    config: { ...DEFAULT_RESILIENCE_CONFIG, enabled: true },
    strictMode: false,
    supervisorTrace: trace(["completion_claim_without_tool", "required_tools_contract"]),
    executionContract: {
      ...pendingContract,
      requiredToolNames: ["audaar_check_in"],
      pendingToolNames: ["audaar_check_in"],
      violations: ["required_tool_missing:audaar_check_in"],
    },
    retryCount: 1,
    recoveryCount: 1,
    toolOutcomes: [{ name: "audaar_check_in", ok: false }],
    replyText: "Check-in concluído com sucesso!",
  });
  assert.equal(d.action, "apply_fallback");
  assert.equal(d.reason, "completion_claim_without_tool");
  assert.ok(d.fallbackMessage && /Não consegui concluir o check-in/i.test(d.fallbackMessage));
});
