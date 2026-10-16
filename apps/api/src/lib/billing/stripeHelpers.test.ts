import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";
import {
  getEventOrganizationId,
  getInvoiceSubscriptionId,
  getSubscriptionBillingPeriod,
  invoiceServicePeriodEndUnix,
  nextChargeAfterPayment,
} from "./stripeHelpers.js";

describe("stripeHelpers", () => {
  it("getSubscriptionBillingPeriod reads first item", () => {
    const sub = {
      items: { data: [{ current_period_start: 100, current_period_end: 200 }] },
    } as unknown as Stripe.Subscription;
    assert.deepEqual(getSubscriptionBillingPeriod(sub), {
      currentPeriodStart: 100,
      currentPeriodEnd: 200,
    });
  });

  it("getInvoiceSubscriptionId reads parent.subscription_details", () => {
    const invoice = {
      parent: { subscription_details: { subscription: "sub_123" } },
    } as unknown as Stripe.Invoice;
    assert.equal(getInvoiceSubscriptionId(invoice), "sub_123");
  });

  it("invoiceServicePeriodEndUnix prefers the latest line period", () => {
    assert.equal(
      invoiceServicePeriodEndUnix({
        period_end: 100,
        lines: { data: [{ period: { end: 200 } }, { period: { end: 150 } }] },
      }),
      200,
    );
    assert.equal(invoiceServicePeriodEndUnix({ period_end: 300 }), 300);
    assert.equal(invoiceServicePeriodEndUnix({}), null);
  });

  it("nextChargeAfterPayment moves a past due date one cycle after the payment", () => {
    const paidAt = new Date("2026-10-16T15:00:00.000Z");
    const now = new Date("2026-10-16T18:00:00.000Z");
    assert.equal(nextChargeAfterPayment(paidAt, "month", now).toISOString(), "2026-11-16T15:00:00.000Z");
    assert.equal(
      nextChargeAfterPayment(new Date("2026-10-10T00:00:00.000Z"), "month", now).toISOString(),
      "2026-11-10T00:00:00.000Z",
    );
  });

  it("getEventOrganizationId reads metadata", () => {
    const event = {
      data: { object: { metadata: { organizationId: "org-1" } } },
    } as unknown as Stripe.Event;
    assert.equal(getEventOrganizationId(event), "org-1");
  });
});
