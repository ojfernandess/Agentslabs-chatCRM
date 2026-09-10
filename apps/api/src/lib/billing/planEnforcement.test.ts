import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlanEnforcementError } from "./planEnforcement.js";
import { resolveLimitValue } from "./PlanEntitlementService.js";

describe("planEnforcement", () => {
  it("PlanEnforcementError carries code and status", () => {
    const err = new PlanEnforcementError("limit", "plan_limit_agents", 402, { used: 3, limit: 3 });
    assert.equal(err.code, "plan_limit_agents");
    assert.equal(err.statusCode, 402);
    assert.deepEqual(err.details, { used: 3, limit: 3 });
  });

  it("resolveLimitValue treats null as unlimited for enforcement", () => {
    assert.equal(resolveLimitValue(null), null);
    assert.equal(resolveLimitValue(undefined), null);
    assert.equal(resolveLimitValue(100), 100);
  });
});
