import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("MercadoPagoPlanService helpers", () => {
  it("planIsMercadoPagoReady accepts free plans without mercadopagoPlanId", async () => {
    const { planIsMercadoPagoReady } = await import("./MercadoPagoPlanService.js");
    assert.equal(planIsMercadoPagoReady({ amountCents: 0, mercadopagoPlanId: null }), true);
    assert.equal(planIsMercadoPagoReady({ amountCents: 1000, mercadopagoPlanId: "mp_plan_1" }), true);
    assert.equal(planIsMercadoPagoReady({ amountCents: 1000, mercadopagoPlanId: null }), false);
  });

  it("createMercadoPagoPreapprovalPlan posts monthly plan payload to Mercado Pago", async () => {
    const origFetch = globalThis.fetch;
    let capturedPath = "";
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input, init) => {
      capturedPath = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "mp_test_plan", status: "active" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const { createMercadoPagoPreapprovalPlan } = await import("./MercadoPagoPlanService.js");
      const result = await createMercadoPagoPreapprovalPlan("test_token", {
        id: "plan_1",
        slug: "growth",
        name: "Growth",
        description: "Test plan",
        amountCents: 9900,
        currency: "BRL",
        interval: "month",
      });

      assert.equal(result.id, "mp_test_plan");
      assert.match(capturedPath, /\/preapproval_plan$/);
      assert.equal(capturedBody.reason, "Growth");
      assert.equal(capturedBody.external_reference, "ONX-PLAN-plan_1");
      assert.deepEqual(capturedBody.auto_recurring, {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 99,
        currency_id: "BRL",
      });
      assert.deepEqual(capturedBody.payment_methods_allowed, {
        payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "bank_transfer" }],
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("createMercadoPagoPreapprovalPlan uses 12-month frequency for yearly plans", async () => {
    const origFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "mp_year_plan", status: "active" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const { createMercadoPagoPreapprovalPlan } = await import("./MercadoPagoPlanService.js");
      await createMercadoPagoPreapprovalPlan("test_token", {
        id: "plan_2",
        slug: "enterprise-year",
        name: "Enterprise",
        description: null,
        amountCents: 120000,
        currency: "BRL",
        interval: "year",
      });

      assert.equal((capturedBody.auto_recurring as { frequency?: number }).frequency, 12);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
