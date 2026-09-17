import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "../StripeCustomerService.js";
import {
  isMercadoPagoSandboxAccessToken,
  mercadoPagoRequest,
} from "./mercadoPagoClient.js";
import { resolveMercadoPagoSandboxPayerEmail } from "../mercadoPagoBillingSettings.js";

describe("Mercado Pago sandbox helpers", () => {
  it("detects sandbox access tokens by TEST- prefix", () => {
    assert.equal(isMercadoPagoSandboxAccessToken("TEST-123"), true);
    assert.equal(isMercadoPagoSandboxAccessToken("APP_USR-123"), false);
  });

  it("normalizes payer email to @testuser.com in sandbox", () => {
    assert.equal(resolveMercadoPagoSandboxPayerEmail("admin@empresa.com"), "admin@testuser.com");
    assert.equal(resolveMercadoPagoSandboxPayerEmail("buyer@testuser.com"), "buyer@testuser.com");
  });
});

describe("mercadoPagoRequest error handling", () => {
  it("propagates live credential billing errors instead of mercadopago_unreachable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ message: "Unauthorized use of live credentials", error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    try {
      await assert.rejects(
        () =>
          mercadoPagoRequest({
            accessToken: "TEST-token",
            method: "POST",
            path: "/v1/payments",
            body: { payment_method_id: "pix" },
          }),
        (err: unknown) =>
          err instanceof BillingError && err.code === "mercadopago_live_credentials_unauthorized",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
