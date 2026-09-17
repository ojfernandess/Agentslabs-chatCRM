import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PlanEnforcementError,
  normalizePlanLimitUsageKey,
  resolveUsedCountForPlanLimitKey,
  resolveUsageCountKey,
} from "./planEnforcement.js";
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

  it("normalizePlanLimitUsageKey strips accents and case", () => {
    assert.equal(normalizePlanLimitUsageKey("Usuários"), "usuarios");
    assert.equal(normalizePlanLimitUsageKey("  UTILIZADORES "), "utilizadores");
  });

  it("resolveUsageCountKey maps Portuguese user limit keys", () => {
    assert.equal(resolveUsageCountKey("users"), "users");
    assert.equal(resolveUsageCountKey("Usuários"), "users");
    assert.equal(resolveUsageCountKey("utilizadores"), "users");
  });

  it("resolveUsedCountForPlanLimitKey reads team member usage for user limits", () => {
    const counts = { users: 4, seats: 2, agents: 1 };
    assert.equal(resolveUsedCountForPlanLimitKey("users", counts), 4);
    assert.equal(resolveUsedCountForPlanLimitKey("Usuários", counts), 4);
    assert.equal(resolveUsedCountForPlanLimitKey("utilizadores", counts), 4);
    assert.equal(resolveUsedCountForPlanLimitKey("seats", counts), 2);
    assert.equal(resolveUsedCountForPlanLimitKey("agents", counts), 1);
    assert.equal(resolveUsedCountForPlanLimitKey("unknown_metric", counts), 0);
  });
});
