import assert from "node:assert/strict";
import test from "node:test";
import {
  blockReasonFromTurnContract,
  shouldBlockOutboundFromTurnContract,
} from "./executionContractGate.js";
import type { ExecutionContract } from "./types.js";

const baseContract: ExecutionContract = {
  version: 1,
  turnId: "t1",
  userMessage: "check-in",
  objective: "consult reservation",
  planPhase: "tooling",
  requiredToolNames: ["audaar_consultar_reserva"],
  forbiddenToolNames: [],
  pendingToolNames: ["audaar_consultar_reserva"],
  satisfiedToolNames: [],
  requiredFacts: [],
  existingFacts: [],
  constraints: [],
  completionCriteria: ["pending_tools:audaar_consultar_reserva"],
  valid: false,
  violations: ["required_tool_missing:audaar_consultar_reserva"],
};

test("shouldBlockOutboundFromTurnContract honors validationBlockSend without strict mode", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: false,
      validationBlockSend: true,
      retryCount: 0,
      canRetry: false,
      executionContract: baseContract,
    }),
    true,
  );
});

test("shouldBlockOutboundFromTurnContract blocks on validationBlockSend in strict mode", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      validationBlockSend: true,
      retryCount: 0,
      canRetry: false,
    }),
    true,
  );
});

test("shouldBlockOutboundFromTurnContract allows without block when strict off and no validationBlockSend", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: false,
      validationBlockSend: false,
      retryCount: 0,
      canRetry: false,
      executionContract: baseContract,
    }),
    false,
  );
});
test("shouldBlockOutboundFromTurnContract blocks when required tool missing", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      retryCount: 0,
      canRetry: false,
      executionContract: baseContract,
      toolOutcomes: [{ name: "buscar_conhecimento", ok: true }],
    }),
    true,
  );
});

test("shouldBlockOutboundFromTurnContract allows when required tools satisfied", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      retryCount: 0,
      canRetry: false,
      executionContract: {
        ...baseContract,
        valid: true,
        pendingToolNames: [],
        satisfiedToolNames: ["audaar_consultar_reserva"],
        violations: [],
      },
      toolOutcomes: [{ name: "audaar_consultar_reserva", ok: true }],
    }),
    false,
  );
});

test("shouldBlockOutboundFromTurnContract blocks supervisor rejection after retries", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      retryCount: 2,
      canRetry: false,
      supervisorTrace: {
        approved: false,
        summary: "required tool missing",
        checks: [],
        retryCount: 2,
      },
    }),
    true,
  );
});

test("shouldBlockOutboundFromTurnContract recoverFirst does not wipe on pending Required", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      retryCount: 2,
      canRetry: false,
      executionContract: baseContract,
      toolOutcomes: [],
      recoverFirst: true,
    }),
    false,
  );
});

test("shouldBlockOutboundFromTurnContract recoverFirst still blocks policy validationBlockSend", () => {
  assert.equal(
    shouldBlockOutboundFromTurnContract({
      strictMode: true,
      validationBlockSend: true,
      retryCount: 2,
      canRetry: false,
      executionContract: baseContract,
      recoverFirst: true,
    }),
    true,
  );
});

test("blockReasonFromTurnContract prefers validation_block_send", () => {
  assert.equal(
    blockReasonFromTurnContract({
      strictMode: true,
      validationBlockSend: true,
      retryCount: 0,
      canRetry: false,
      executionContract: baseContract,
    }),
    "validation_block_send",
  );
});
