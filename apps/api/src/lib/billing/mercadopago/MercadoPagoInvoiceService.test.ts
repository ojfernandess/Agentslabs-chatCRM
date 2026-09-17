import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapMercadoPagoAuthorizedPaymentToInvoiceRow,
  mapMercadoPagoPaymentToInvoiceRow,
  normalizeMercadoPagoInvoiceStatus,
  resolveMercadoPagoReceiptUrl,
} from "./MercadoPagoInvoiceService.js";

describe("MercadoPagoInvoiceService mappers", () => {
  it("maps approved Pix payment to paid invoice row with cents and receipt url", () => {
    const row = mapMercadoPagoPaymentToInvoiceRow({
      id: 123456789,
      status: "approved",
      date_approved: "2026-03-01T12:00:00.000Z",
      transaction_amount: 99.9,
      currency_id: "BRL",
      point_of_interaction: {
        transaction_data: {
          ticket_url: "https://www.mercadopago.com.br/payments/123/ticket",
        },
      },
    });

    assert.equal(row.id, "123456789");
    assert.equal(row.number, "123456789");
    assert.equal(row.status, "paid");
    assert.equal(row.amountPaid, 9990);
    assert.equal(row.currency, "brl");
    assert.equal(row.hostedInvoiceUrl, "https://www.mercadopago.com.br/payments/123/ticket");
    assert.equal(row.invoicePdf, null);
  });

  it("maps authorized subscription payment with processed status to paid", () => {
    const row = mapMercadoPagoAuthorizedPaymentToInvoiceRow({
      id: 987654,
      status: "processed",
      debit_date: "2026-02-15T10:00:00.000Z",
      transaction_amount: 149,
      currency_id: "BRL",
      payment: {
        id: 555001,
        status: "approved",
      },
    });

    assert.equal(row.id, "555001");
    assert.equal(row.status, "paid");
    assert.equal(row.amountPaid, 14900);
    assert.equal(row.amountDue, 0);
    assert.equal(row.created, "2026-02-15T10:00:00.000Z");
  });

  it("normalizes pending and rejected statuses for invoice labels", () => {
    assert.equal(normalizeMercadoPagoInvoiceStatus("pending"), "open");
    assert.equal(normalizeMercadoPagoInvoiceStatus(undefined, "scheduled"), "open");
    assert.equal(normalizeMercadoPagoInvoiceStatus("rejected"), "void");
    assert.equal(normalizeMercadoPagoInvoiceStatus("approved"), "paid");
  });

  it("prefers ticket url and falls back to external resource url", () => {
    assert.equal(
      resolveMercadoPagoReceiptUrl({
        id: 1,
        point_of_interaction: { transaction_data: { ticket_url: "https://ticket" } },
        transaction_details: { external_resource_url: "https://receipt" },
      }),
      "https://ticket",
    );
    assert.equal(
      resolveMercadoPagoReceiptUrl({
        id: 1,
        transaction_details: { external_resource_url: "https://receipt" },
      }),
      "https://receipt",
    );
  });
});
