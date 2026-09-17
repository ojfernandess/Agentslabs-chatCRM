import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPaymentProviderName,
  subscriptionHasExternalBilling,
  subscriptionIsProviderManaged,
} from "./billingTypes.js";

describe("billingTypes — payment providers", () => {
  it("validates payment provider names", () => {
    assert.equal(isPaymentProviderName("stripe"), true);
    assert.equal(isPaymentProviderName("mercadopago"), true);
    assert.equal(isPaymentProviderName("paypal"), false);
  });

  it("detects external billing via generic external ids", () => {
    assert.equal(
      subscriptionHasExternalBilling({ externalSubscriptionId: "sub_mp_123" }),
      true,
    );
    assert.equal(
      subscriptionHasExternalBilling({ stripeSubscriptionId: "sub_stripe_123" }),
      true,
    );
    assert.equal(subscriptionHasExternalBilling({}), false);
  });

  it("detects provider-managed subscriptions", () => {
    assert.equal(subscriptionIsProviderManaged({ externalSubscriptionId: "a" }), true);
    assert.equal(subscriptionIsProviderManaged({ stripeSubscriptionId: "b" }), true);
    assert.equal(subscriptionIsProviderManaged({ paymentProvider: "mercadopago" }), false);
  });
});
