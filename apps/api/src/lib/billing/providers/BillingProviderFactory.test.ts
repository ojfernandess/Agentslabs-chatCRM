import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBillingProvider,
  listBillingProviderNames,
  resolveDefaultPaymentProvider,
} from "./BillingProviderFactory.js";
import { MERCADOPAGO_BILLING_CAPABILITIES, STRIPE_BILLING_CAPABILITIES } from "./types.js";

describe("BillingProviderFactory", () => {
  it("lists stripe and mercadopago providers", () => {
    assert.deepEqual(listBillingProviderNames(), ["stripe", "mercadopago"]);
  });

  it("defaults to stripe", () => {
    assert.equal(resolveDefaultPaymentProvider(), "stripe");
  });

  it("returns stripe provider with portal capability", () => {
    const stripe = getBillingProvider("stripe");
    assert.equal(stripe.name, "stripe");
    assert.equal(stripe.capabilities.billingPortal, true);
    assert.equal(stripe.capabilities.pix, false);
    assert.deepEqual(stripe.capabilities, STRIPE_BILLING_CAPABILITIES);
  });

  it("returns mercadopago stub with pix capability and no portal", () => {
    const mp = getBillingProvider("mercadopago");
    assert.equal(mp.name, "mercadopago");
    assert.equal(mp.capabilities.pix, true);
    assert.equal(mp.capabilities.billingPortal, false);
    assert.deepEqual(mp.capabilities, MERCADOPAGO_BILLING_CAPABILITIES);
  });

  it("exposes mercadopago as not configured without env", async () => {
    const prev = process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    try {
      const { mercadoPagoBillingProvider } = await import("./mercadopago/MercadoPagoBillingProvider.js");
      assert.equal(await mercadoPagoBillingProvider.isConfigured(), false);
      const cfg = await mercadoPagoBillingProvider.getClientConfig();
      assert.equal(cfg.configured, false);
      assert.equal(cfg.connected, false);
      assert.equal(cfg.enabled, true);
    } finally {
      if (prev != null) process.env.MERCADOPAGO_ACCESS_TOKEN = prev;
    }
  });
});
