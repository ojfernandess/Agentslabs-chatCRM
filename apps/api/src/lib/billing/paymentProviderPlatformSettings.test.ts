import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readPaymentProviderPlatformSettings,
} from "./paymentProviderPlatformSettings.js";

describe("paymentProviderPlatformSettings", () => {
  it("defaults both providers to enabled", () => {
    const settings = readPaymentProviderPlatformSettings(null);
    assert.equal(settings.stripe.enabled, true);
    assert.equal(settings.mercadopago.enabled, true);
  });

  it("reads explicit disabled toggles", () => {
    const settings = readPaymentProviderPlatformSettings({
      stripe: { enabled: false },
      mercadopago: { enabled: true },
    });
    assert.equal(settings.stripe.enabled, false);
    assert.equal(settings.mercadopago.enabled, true);
  });
});
