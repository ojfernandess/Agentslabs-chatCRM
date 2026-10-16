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

/** Fim do período cobrado na fatura — a próxima cobrança começa nesse instante. */
export function invoiceServicePeriodEndUnix(invoice: {
  period_end?: number | null;
  lines?: { data?: Array<{ period?: { end?: number | null } | null }> | null } | null;
}): number | null {
  const lineEnds = (invoice.lines?.data ?? [])
    .map((line) => line.period?.end)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const candidates = [...lineEnds];
  if (typeof invoice.period_end === "number" && invoice.period_end > 0) {
    candidates.push(invoice.period_end);
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/** Próxima cobrança depois de um pagamento: um ciclo à frente, sempre no futuro. */
export function nextChargeAfterPayment(paidAt: Date, interval: string, now = new Date()): Date {
  const step = (date: Date): Date => {
    const end = new Date(date.getTime());
    if (interval === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
    else end.setUTCMonth(end.getUTCMonth() + 1);
    return end;
  };
  let next = step(paidAt);
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard < 36) {
    next = step(next);
    guard += 1;
  }
  return next;
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
