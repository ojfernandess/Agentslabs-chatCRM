import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "./StripeCustomerService.js";
import {
  assertMercadoPagoTokenMatchesMode,
  inferMercadoPagoTokenMode,
  resolveMercadoPagoSandboxPayerEmail,
} from "./mercadoPagoBillingSettings.js";

describe("mercadoPagoBillingSettings", () => {
  it("only treats legacy TEST- prefix as sandbox; APP_USR is unknown", () => {
    assert.equal(inferMercadoPagoTokenMode("TEST-abc"), "sandbox");
    assert.equal(inferMercadoPagoTokenMode("APP_USR-abc"), "unknown");
    assert.equal(inferMercadoPagoTokenMode("other"), "unknown");
  });

  it("uses MP recommended sandbox payer email", () => {
    assert.equal(resolveMercadoPagoSandboxPayerEmail("admin@empresa.com"), "test_user_br@testuser.com");
  });

  it("does not reject APP_USR tokens in sandbox mode (MP test tokens use APP_USR)", () => {
    assert.doesNotThrow(() => assertMercadoPagoTokenMatchesMode("APP_USR-123", "sandbox"));
  });
});
