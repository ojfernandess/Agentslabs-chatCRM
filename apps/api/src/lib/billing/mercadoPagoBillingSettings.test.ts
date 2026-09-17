import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "./StripeCustomerService.js";
import {
  assertMercadoPagoTokenMatchesMode,
  inferMercadoPagoTokenMode,
  resolveMercadoPagoSandboxPayerEmail,
} from "./mercadoPagoBillingSettings.js";

describe("mercadoPagoBillingSettings", () => {
  it("infers token mode from prefix", () => {
    assert.equal(inferMercadoPagoTokenMode("TEST-abc"), "sandbox");
    assert.equal(inferMercadoPagoTokenMode("APP_USR-abc"), "production");
    assert.equal(inferMercadoPagoTokenMode("other"), "unknown");
  });

  it("normalizes sandbox payer email", () => {
    assert.equal(resolveMercadoPagoSandboxPayerEmail("admin@empresa.com"), "admin@testuser.com");
  });

  it("throws when token mode mismatches selected billing mode", () => {
    assert.throws(
      () => assertMercadoPagoTokenMatchesMode("APP_USR-123", "sandbox"),
      (err: unknown) => err instanceof BillingError && err.code === "mercadopago_token_mode_mismatch",
    );
  });
});
