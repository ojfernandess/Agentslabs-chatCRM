import type Stripe from "stripe";

const PERIOD_SECONDS = 30 * 86_400;

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function makeStripeSubscription(
  input: {
    id?: string;
    organizationId: string;
    planId: string;
    priceId?: string;
    customerId?: string;
    status?: Stripe.Subscription.Status;
    cancelAtPeriodEnd?: boolean;
  },
  overrides?: Partial<Stripe.Subscription>,
): Stripe.Subscription {
  const now = unixNow();
  const priceId = input.priceId ?? "price_test_growth";
  return {
    id: input.id ?? "sub_test_billing_flow",
    object: "subscription",
    status: input.status ?? "active",
    customer: input.customerId ?? "cus_test_billing",
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    metadata: {
      organizationId: input.organizationId,
      planId: input.planId,
      planSlug: "growth",
    },
    items: {
      object: "list",
      data: [
        {
          id: "si_test_item",
          object: "subscription_item",
          current_period_start: now,
          current_period_end: now + PERIOD_SECONDS,
          price: { id: priceId, object: "price" } as Stripe.Price,
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "/v1/subscription_items",
    },
    ...overrides,
  } as Stripe.Subscription;
}

export function makeCheckoutSessionCompletedEvent(input: {
  eventId: string;
  sessionId: string;
  organizationId: string;
  planId: string;
  subscriptionId: string;
  customerId?: string;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        subscription: input.subscriptionId,
        client_reference_id: input.organizationId,
        customer: input.customerId ?? "cus_test_billing",
        metadata: {
          organizationId: input.organizationId,
          planId: input.planId,
        },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

export function makeSubscriptionUpdatedEvent(
  subscription: Stripe.Subscription,
  eventId: string,
): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    type: "customer.subscription.updated",
    data: { object: subscription },
  } as Stripe.Event;
}

export function makeInvoicePaymentFailedEvent(input: {
  eventId: string;
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: input.invoiceId,
        object: "invoice",
        customer: input.customerId,
        amount_due: 9900,
        currency: "brl",
        parent: {
          subscription_details: { subscription: input.subscriptionId },
        },
      } as Stripe.Invoice,
    },
  } as Stripe.Event;
}

export function makeInvoicePaidEvent(input: {
  eventId: string;
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "invoice.paid",
    data: {
      object: {
        id: input.invoiceId,
        object: "invoice",
        customer: input.customerId,
        amount_paid: 9900,
        currency: "brl",
        parent: {
          subscription_details: { subscription: input.subscriptionId },
        },
      } as Stripe.Invoice,
    },
  } as Stripe.Event;
}
