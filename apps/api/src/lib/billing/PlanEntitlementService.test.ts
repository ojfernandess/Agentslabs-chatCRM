import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLimitValue } from "./PlanEntitlementService.js";
import { isAccessGrantingStatus } from "./billingTypes.js";

describe("PlanEntitlementService helpers", () => {
  it("resolveLimitValue treats null as unlimited", () => {
    assert.equal(resolveLimitValue(null), null);
    assert.equal(resolveLimitValue(100), 100);
    assert.equal(resolveLimitValue(undefined), null);
  });

  it("past_due is access-granting before grace enforcement in snapshot builder", () => {
    assert.equal(isAccessGrantingStatus("past_due"), true);
  });
});
