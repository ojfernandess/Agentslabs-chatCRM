import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMercadoPagoSandboxAccessToken,
  resolveMercadoPagoSandboxPayerEmail,
} from "./mercadoPagoClient.js";

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
