import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldDeliverEscalationTransferAfterGeneration,
  shouldDiscardStaleAgentTurn,
  shouldInvokeAutomaticHandoff,
} from "./agentHandoffTurnGuards.js";

describe("agentHandoffTurnGuards", () => {
  it("shouldDiscardStaleAgentTurn when handoff already active at turn start", () => {
    assert.equal(shouldDiscardStaleAgentTurn(true), true);
    assert.equal(shouldDiscardStaleAgentTurn(false), false);
  });

  it("shouldInvokeAutomaticHandoff only when not already awaiting human", () => {
    assert.equal(shouldInvokeAutomaticHandoff(false), true);
    assert.equal(shouldInvokeAutomaticHandoff(true), false);
  });

  it("shouldDeliverEscalationTransferAfterGeneration only for this turn's call_human", () => {
    assert.equal(
      shouldDeliverEscalationTransferAfterGeneration(false, true, true),
      true,
    );
    assert.equal(
      shouldDeliverEscalationTransferAfterGeneration(false, true, false),
      false,
    );
    assert.equal(
      shouldDeliverEscalationTransferAfterGeneration(true, true, true),
      false,
    );
    assert.equal(
      shouldDeliverEscalationTransferAfterGeneration(false, false, true),
      false,
    );
  });
});
