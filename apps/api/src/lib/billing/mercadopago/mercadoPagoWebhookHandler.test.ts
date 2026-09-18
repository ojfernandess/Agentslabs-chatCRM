import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { verifyMercadoPagoWebhookSignature } from "./mercadoPagoWebhookSignature.js";
import { resolveOrganizationIdFromMercadoPagoReference } from "../subscriptionSync.js";

describe("Mercado Pago webhook signature", () => {
  it("verifyMercadoPagoWebhookSignature validates HMAC manifest", () => {
    const secret = "test-webhook-secret";
    const dataId = "123456789";
    const xRequestId = "abc-def-ghi";
    const ts = "1704908010";
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

    assert.equal(
      verifyMercadoPagoWebhookSignature({
        secret,
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId,
        dataId,
      }),
      true,
    );
  });

  it("verifyMercadoPagoWebhookSignature rejects invalid signature", () => {
    assert.equal(
      verifyMercadoPagoWebhookSignature({
        secret: "test-webhook-secret",
        xSignature: "ts=1704908010,v1=deadbeef",
        xRequestId: "abc",
        dataId: "123",
      }),
      false,
    );
  });

  it("verifyMercadoPagoWebhookSignature rejects missing headers", () => {
    assert.equal(
      verifyMercadoPagoWebhookSignature({
        secret: "secret",
        xSignature: undefined,
        xRequestId: "req",
        dataId: "1",
      }),
      false,
    );
  });
});

describe("Mercado Pago webhook reference parsing", () => {
  it("resolveOrganizationIdFromMercadoPagoReference extracts UUID from ONX prefix", () => {
    const orgId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ref = `ONX-${orgId}-${randomUUID()}`;
    assert.equal(resolveOrganizationIdFromMercadoPagoReference(ref), orgId);
  });

  it("resolveOrganizationIdFromMercadoPagoReference extracts UUID from ONX-AI prefix", () => {
    const orgId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ref = `ONX-AI-${orgId}-${randomUUID()}`;
    assert.equal(resolveOrganizationIdFromMercadoPagoReference(ref), orgId);
  });

  it("resolveOrganizationIdFromMercadoPagoReference returns null for invalid ref", () => {
    assert.equal(resolveOrganizationIdFromMercadoPagoReference("invalid"), null);
    assert.equal(resolveOrganizationIdFromMercadoPagoReference(null), null);
  });
});
