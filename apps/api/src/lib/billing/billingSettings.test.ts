import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBillingPlatformSettings } from "./billingSettings.js";

describe("billingSettings", () => {
  it("readBillingPlatformSettings clamps grace period", () => {
    assert.deepEqual(readBillingPlatformSettings(null), { gracePeriodDays: 7 });
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: 120 }), { gracePeriodDays: 90 });
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: -5 }), { gracePeriodDays: 0 });
    assert.deepEqual(readBillingPlatformSettings({ gracePeriodDays: 14 }), { gracePeriodDays: 14 });
  });
});
