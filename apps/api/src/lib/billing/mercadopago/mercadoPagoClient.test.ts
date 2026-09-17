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

  it("uses MP recommended sandbox payer email", () => {
    assert.equal(resolveMercadoPagoSandboxPayerEmail("admin@empresa.com"), "test_user_br@testuser.com");
    assert.equal(resolveMercadoPagoSandboxPayerEmail("buyer@testuser.com"), "test_user_br@testuser.com");
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
            billingMode: "sandbox",
          }),
        (err: unknown) =>
          err instanceof BillingError && err.code === "mercadopago_live_credentials_unauthorized",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps missing Pix key errors to mercadopago_pix_key_required", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: "Collector user without key enabled for QR render",
          error: "bad_request",
          cause: [{ code: 13253, description: "Collector user without key enabled for QR render" }],
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    try {
      await assert.rejects(
        () =>
          mercadoPagoRequest({
            accessToken: "APP_USR-token",
            method: "POST",
            path: "/v1/payments",
            body: { payment_method_id: "pix" },
            billingMode: "production",
          }),
        (err: unknown) => err instanceof BillingError && err.code === "mercadopago_pix_key_required",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
