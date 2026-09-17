import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BillingError } from "../StripeCustomerService.js";
import { buildMercadoPagoPixPayer } from "./MercadoPagoPixPaymentService.js";

describe("buildMercadoPagoPixPayer", () => {
  it("builds payer with CPF when 11 digits are provided", () => {
    const payer = buildMercadoPagoPixPayer("cliente@example.com", "123.456.789-01");
    assert.deepEqual(payer, {
      email: "cliente@example.com",
      first_name: "cliente",
      last_name: "OpenConduit",
      identification: { type: "CPF", number: "12345678901" },
    });
  });

  it("builds payer with CNPJ when 14 digits are provided", () => {
    const payer = buildMercadoPagoPixPayer("empresa@example.com", "12.345.678/0001-90");
    assert.deepEqual(payer, {
      email: "empresa@example.com",
      first_name: "empresa",
      last_name: "OpenConduit",
      identification: { type: "CNPJ", number: "12345678000190" },
    });
  });

  it("throws when document is missing or invalid", () => {
    assert.throws(
      () => buildMercadoPagoPixPayer("cliente@example.com"),
      (err: unknown) => err instanceof BillingError && err.code === "mercadopago_pix_document_required",
    );
  });
});
