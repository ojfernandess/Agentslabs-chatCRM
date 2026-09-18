import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_META_BILLING_POLICY_PHASES,
  parseMetaBillingPolicyPhases,
  resolveActiveBillingPolicyPhase,
} from "./metaBillingPolicy.js";

describe("resolveActiveBillingPolicyPhase", () => {
  it("uses pre-2026-10 phase in September 2026", () => {
    const at = new Date("2026-09-17T12:00:00.000Z");
    const phase = resolveActiveBillingPolicyPhase(DEFAULT_META_BILLING_POLICY_PHASES, at);
    assert.equal(phase.id, "pre-2026-10");
    assert.equal(phase.serviceInWindowFree, true);
    assert.equal(phase.utilityInWindowFree, true);
  });

  it("uses from-2026-10 phase in October 2026", () => {
    const at = new Date("2026-10-15T12:00:00.000Z");
    const phase = resolveActiveBillingPolicyPhase(DEFAULT_META_BILLING_POLICY_PHASES, at);
    assert.equal(phase.id, "from-2026-10");
    assert.equal(phase.serviceInWindowFree, false);
    assert.equal(phase.utilityInWindowFree, false);
    assert.equal(phase.serviceFreeTierPerNumberPerMonth, 1000);
  });
});

describe("parseMetaBillingPolicyPhases", () => {
  it("falls back to defaults for invalid input", () => {
    const phases = parseMetaBillingPolicyPhases(null);
    assert.equal(phases.length, 2);
    assert.equal(phases[0]?.id, "pre-2026-10");
  });
});
