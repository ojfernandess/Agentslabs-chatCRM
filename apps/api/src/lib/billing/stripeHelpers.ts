import type Stripe from "stripe";

/** Stripe v22+: período corrente nos subscription items (não mais no objeto Subscription). */
export function getSubscriptionBillingPeriod(subscription: Stripe.Subscription): {
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
} {
  const item = subscription.items?.data?.[0];
  if (!item) return { currentPeriodStart: null, currentPeriodEnd: null };
  return {
    currentPeriodStart: item.current_period_start ?? null,
    currentPeriodEnd: item.current_period_end ?? null,
  };
}

/** Stripe v22+: subscription id em invoice.parent.subscription_details. */
export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

export function getEventOrganizationId(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as {
    metadata?: Record<string, string>;
    client_reference_id?: string;
  };
  return (
    obj.metadata?.organizationId?.trim() ||
    obj.metadata?.opennexoOrgId?.trim() ||
    obj.client_reference_id?.trim() ||
    null
  );
}
