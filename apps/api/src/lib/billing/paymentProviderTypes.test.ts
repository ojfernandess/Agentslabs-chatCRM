import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPaymentProviderName,
  mapMercadoPagoPreapprovalStatus,
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
    assert.equal(
      subscriptionIsProviderManaged({ paymentProvider: "mercadopago", externalSubscriptionId: "pay_123" }),
      false,
    );
  });

  it("maps Mercado Pago preapproval statuses", () => {
    assert.equal(mapMercadoPagoPreapprovalStatus("authorized"), "active");
    assert.equal(mapMercadoPagoPreapprovalStatus("pending"), "incomplete");
  });

  it("maps Mercado Pago payment statuses", async () => {
    const { mapMercadoPagoPaymentStatus } = await import("./billingTypes.js");
    assert.equal(mapMercadoPagoPaymentStatus("approved"), "active");
    assert.equal(mapMercadoPagoPaymentStatus("pending"), "pending_payment");
    assert.equal(mapMercadoPagoPaymentStatus("rejected"), "incomplete");
  });
});
