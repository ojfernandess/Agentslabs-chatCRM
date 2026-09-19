import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BILLING_PLATFORM_SETTINGS,
  readBillingPlatformSettings,
} from "./billingSettings.js";

describe("billingSettings", () => {
  it("readBillingPlatformSettings clamps grace period and defaults enforcement", () => {
    assert.deepEqual(readBillingPlatformSettings(null), DEFAULT_BILLING_PLATFORM_SETTINGS);
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: 120 }), {
      ...DEFAULT_BILLING_PLATFORM_SETTINGS,
      gracePeriodDays: 90,
    });
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: -5 }), {
      ...DEFAULT_BILLING_PLATFORM_SETTINGS,
      gracePeriodDays: 0,
    });
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: 14 }), {
      ...DEFAULT_BILLING_PLATFORM_SETTINGS,
      gracePeriodDays: 14,
    });
    assert.deepEqual(readBillingPlatformSettings({ checkoutExpirationHours: 500 }), {
      ...DEFAULT_BILLING_PLATFORM_SETTINGS,
      checkoutExpirationHours: 168,
    });
  });

  it("readBillingPlatformSettings parses overage mode and meters", () => {
    const parsed = readBillingPlatformSettings({
      limitEnforcementMode: "overage",
      overage: {
        agents: {
          enabled: true,
          stripeMeterEventName: "agents_overage",
          unitAmountCents: 500,
        },
      },
    });
    assert.equal(parsed.limitEnforcementMode, "overage");
    assert.equal(parsed.overage.agents.enabled, true);
    assert.equal(parsed.overage.agents.stripeMeterEventName, "agents_overage");
    assert.equal(parsed.overage.agents.unitAmountCents, 500);
    assert.equal(parsed.overage.contacts.enabled, false);
  });
});
