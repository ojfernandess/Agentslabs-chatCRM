import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CREDITS_CHECKOUT_MODE,
  isAiCreditsMercadoPagoExternalReference,
  isAiCreditsMercadoPagoPayment,
} from "./AiCreditPurchaseService.js";

describe("AiCreditPurchaseService", () => {
  it("detects AI credits Mercado Pago payments by metadata or external reference", () => {
    assert.equal(AI_CREDITS_CHECKOUT_MODE, "ai_credits");
    assert.equal(
      isAiCreditsMercadoPagoPayment({ id: 1, metadata: { checkoutMode: "ai_credits" } }),
      true,
    );
    assert.equal(
      isAiCreditsMercadoPagoPayment({
        id: 1,
        external_reference: "ONX-AI-a1b2c3d4-e5f6-7890-abcd-ef1234567890-attempt",
      }),
      true,
    );
    assert.equal(
      isAiCreditsMercadoPagoPayment({ id: 1, metadata: { checkoutMode: "pix" } }),
      false,
    );
    assert.equal(isAiCreditsMercadoPagoExternalReference("ONX-AI-org-attempt"), true);
    assert.equal(isAiCreditsMercadoPagoExternalReference("ONX-org-attempt"), false);
  });
});
