import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAccessGrantingStatus,
  mapStripeSubscriptionStatus,
  isPlanLimitEnabled,
  parsePlanExtras,
  parsePlanFeatures,
  parsePlanLimitEnabledFlags,
  parsePlanLimits,
  subscriptionHasStripeBilling,
} from "./billingTypes.js";

describe("billingTypes", () => {
  it("mapStripeSubscriptionStatus maps known statuses", () => {
    assert.equal(mapStripeSubscriptionStatus("active"), "active");
    assert.equal(mapStripeSubscriptionStatus("past_due"), "past_due");
    assert.equal(mapStripeSubscriptionStatus("unknown"), "inactive");
  });

  it("isAccessGrantingStatus grants trialing, active, past_due", () => {
    assert.equal(isAccessGrantingStatus("active"), true);
    assert.equal(isAccessGrantingStatus("past_due"), true);
    assert.equal(isAccessGrantingStatus("canceled"), false);
  });

  it("parsePlanLimits and parsePlanFeatures read JSON", () => {
    assert.deepEqual(parsePlanLimits({ agents: 10, messages: null }), {
      agents: 10,
      messages: null,
    });
    assert.deepEqual(parsePlanFeatures({ rag: true, api: false }), {
      rag: true,
      api: false,
    });
  });

  it("parsePlanLimits ignores __enabled metadata", () => {
    assert.deepEqual(
      parsePlanLimits({ agents: 5, __enabled: { users: false } }),
      { agents: 5 },
    );
    assert.deepEqual(parsePlanLimitEnabledFlags({ __enabled: { users: false } }), {
      users: false,
    });
    assert.equal(isPlanLimitEnabled("users", { users: false }), false);
    assert.equal(isPlanLimitEnabled("agents", { users: false }), true);
  });

  it("parsePlanLimits and parsePlanFeatures preserve custom keys", () => {
    assert.deepEqual(parsePlanLimits({ agents: 3, seats: 25, bad: "x" }), {
      agents: 3,
      seats: 25,
    });
    assert.deepEqual(parsePlanFeatures({ rag: true, voice: false, mcp: 1 }), {
      rag: true,
      voice: false,
    });
  });

  it("parsePlanExtras keeps non-empty strings", () => {
    assert.deepEqual(parsePlanExtras({ support: "24/7", empty: "  " }), {
      support: "24/7",
    });
  });

  it("parsePlanExtras formats structured implementation extras", () => {
    assert.deepEqual(parsePlanExtras({ implementation: { billing: "free" } }), {
      implementation: "Grátis",
    });
    assert.match(
      parsePlanExtras({
        implementation: { billing: "paid", amountCents: 150000, currency: "BRL", description: "Setup" },
      }).implementation ?? "",
      /Setup/,
    );
  });

  it("subscriptionHasStripeBilling detects stripe ids", () => {
    assert.equal(subscriptionHasStripeBilling({}), false);
    assert.equal(subscriptionHasStripeBilling({ stripeCustomerId: "cus_x" }), true);
    assert.equal(subscriptionHasStripeBilling({ stripeSubscriptionId: "sub_x" }), true);
  });
});
