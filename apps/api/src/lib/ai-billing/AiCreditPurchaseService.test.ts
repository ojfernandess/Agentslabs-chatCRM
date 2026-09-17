import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CREDITS_CHECKOUT_MODE,
  isAiCreditsMercadoPagoPayment,
} from "./AiCreditPurchaseService.js";

describe("AiCreditPurchaseService", () => {
  it("detects AI credits Mercado Pago payments by metadata", () => {
    assert.equal(AI_CREDITS_CHECKOUT_MODE, "ai_credits");
    assert.equal(
      isAiCreditsMercadoPagoPayment({ id: 1, metadata: { checkoutMode: "ai_credits" } }),
      true,
    );
    assert.equal(
      isAiCreditsMercadoPagoPayment({ id: 1, metadata: { checkoutMode: "pix" } }),
      false,
    );
  });
});
