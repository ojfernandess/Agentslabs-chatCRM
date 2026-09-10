import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";
import {
  getEventOrganizationId,
  getInvoiceSubscriptionId,
  getSubscriptionBillingPeriod,
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

  it("getEventOrganizationId reads metadata", () => {
    const event = {
      data: { object: { metadata: { organizationId: "org-1" } } },
    } as unknown as Stripe.Event;
    assert.equal(getEventOrganizationId(event), "org-1");
  });
});
