import type Stripe from "stripe";
import { prisma } from "../../db.js";
import { getWebAppPublicOrigin } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { BillingError, ensureStripeCustomer } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";
import { syncSubscriptionFromStripe } from "./subscriptionSync.js";

export type CreateSetupSessionInput = {
  organizationId: string;
  actorUserId: string;
  returnUrl?: string;
  ip?: string | null;
};

/**
 * Stripe Checkout em modo setup — guarda cartão/método para cobranças futuras.
 * @see https://docs.stripe.com/payments/checkout/save-and-reuse
 */
export async function createPaymentMethodSetupSession(
  input: CreateSetupSessionInput,
): Promise<{ url: string; sessionId: string }> {
  const customerId = await ensureStripeCustomer(input.organizationId);
  const stripe = getStripeClient();
  const base = getWebAppPublicOrigin();
  const returnUrl = appendSetupSessionId(
    input.returnUrl?.trim() || `${base}/settings?section=billing&setup=success`,
  );
  const cancelUrl = `${base}/settings?section=billing&setup=cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: returnUrl,
    cancel_url: cancelUrl,
    metadata: {
      organizationId: input.organizationId,
      purpose: "payment_method_setup",
    },
  });

  if (!session.url) {
    throw new BillingError("Stripe Setup Checkout did not return a URL", "setup_no_url");
  }

  await recordBillingAudit({
    action: "billing.payment_method_setup_started",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: session.id,
    ip: input.ip,
  });

  return { url: session.url, sessionId: session.id };
}

/** Portal Stripe com fluxo directo de actualização de método de pagamento. */
export async function createPaymentMethodPortalSession(
  input: CreateSetupSessionInput,
): Promise<{ url: string }> {
  const customerId = await ensureStripeCustomer(input.organizationId);
  const stripe = getStripeClient();
  const returnUrl =
    input.returnUrl?.trim() ||
    `${getWebAppPublicOrigin()}/settings?section=billing`;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    flow_data: {
      type: "payment_method_update",
    },
  });

  if (!session.url) {
    throw new BillingError("Stripe Portal did not return a URL", "portal_no_url");
  }

  await recordBillingAudit({
    action: "billing.payment_method_portal_opened",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: session.id,
    ip: input.ip,
  });

  return { url: session.url };
}

export function getStripeSetupSuccessUrl(): string {
  return appendSetupSessionId(`${getWebAppPublicOrigin()}/settings?section=billing&setup=success`);
}

export function getStripeSetupCancelUrl(): string {
  return `${getWebAppPublicOrigin()}/settings?section=billing&setup=cancel`;
}

function appendSetupSessionId(url: string): string {
  if (url.includes("session_id=")) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}session_id={CHECKOUT_SESSION_ID}`;
}

const CHARGEABLE_SUBSCRIPTION_STATUSES = new Set([
  "pending_payment",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
]);

export type FinalizePaymentMethodSetupResult = {
  saved: boolean;
  charged: boolean;
  hostedInvoiceUrl: string | null;
};

function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Grava o cartão como método padrão e cobra o plano pendente ou vencido.
 * Se o vencimento ainda não chegou, a assinatura Stripe cobra nessa data.
 */
export async function finalizePaymentMethodSetupSession(
  session: Stripe.Checkout.Session,
  actorUserId?: string | null,
): Promise<FinalizePaymentMethodSetupResult> {
  const empty = { saved: false, charged: false, hostedInvoiceUrl: null };
  if (session.mode !== "setup" && session.metadata?.purpose !== "payment_method_setup") {
    return empty;
  }
  const organizationId = session.metadata?.organizationId?.trim();
  const customerId = stripeId(session.customer);
  const setupIntentId = stripeId(session.setup_intent);
  if (!organizationId || !customerId || !setupIntentId) return empty;
  if (session.status && session.status !== "complete") return empty;

  const stripe = getStripeClient();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId = stripeId(setupIntent.payment_method);
  if (!paymentMethodId || setupIntent.status !== "succeeded") return empty;

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    include: {
      plan: {
        select: { id: true, slug: true, amountCents: true, stripePriceId: true },
      },
    },
  });

  let charged = false;
  let hostedInvoiceUrl: string | null = null;

  if (sub?.stripeSubscriptionId?.trim()) {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      default_payment_method: paymentMethodId,
    });
    if (CHARGEABLE_SUBSCRIPTION_STATUSES.has(sub.status)) {
      const paid = await payOpenSubscriptionInvoices(stripe, sub.stripeSubscriptionId);
      charged = paid.charged;
      hostedInvoiceUrl = paid.hostedInvoiceUrl;
      const refreshed = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      await syncSubscriptionFromStripe(refreshed, organizationId);
    }
  } else if (
    sub?.plan &&
    sub.plan.amountCents > 0 &&
    sub.plan.stripePriceId?.trim() &&
    CHARGEABLE_SUBSCRIPTION_STATUSES.has(sub.status)
  ) {
    const created = await createSubscriptionForSavedPaymentMethod({
      stripe,
      organizationId,
      customerId,
      paymentMethodId,
      setupIntentId,
      planId: sub.plan.id,
      planSlug: sub.plan.slug,
      stripePriceId: sub.plan.stripePriceId,
      paymentDueAt: sub.paymentDueAt,
    });
    charged = created.charged;
    hostedInvoiceUrl = created.hostedInvoiceUrl;
  } else if (sub) {
    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: {
        stripeCustomerId: customerId,
        externalCustomerId: customerId,
        paymentProvider: sub.paymentProvider ?? "stripe",
      },
    });
  }

  await recordBillingAudit({
    action: "billing.payment_method_saved",
    organizationId,
    actorUserId,
    resourceId: paymentMethodId,
    metadata: { setupIntentId, charged },
  });

  return { saved: true, charged, hostedInvoiceUrl };
}

async function payOpenSubscriptionInvoices(
  stripe: Stripe,
  subscriptionId: string,
): Promise<{ charged: boolean; hostedInvoiceUrl: string | null }> {
  const open = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "open",
    limit: 5,
  });
  let charged = false;
  let hostedInvoiceUrl: string | null = null;
  for (const invoice of open.data) {
    if (!invoice.id) continue;
    try {
      const paid = await stripe.invoices.pay(invoice.id);
      if (paid.status === "paid") charged = true;
      else if (paid.hosted_invoice_url) hostedInvoiceUrl = paid.hosted_invoice_url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/already paid/i.test(message)) {
        charged = true;
        continue;
      }
      const fresh = await stripe.invoices.retrieve(invoice.id);
      if (fresh.hosted_invoice_url) hostedInvoiceUrl = fresh.hosted_invoice_url;
    }
  }
  return { charged, hostedInvoiceUrl };
}

async function createSubscriptionForSavedPaymentMethod(input: {
  stripe: Stripe;
  organizationId: string;
  customerId: string;
  paymentMethodId: string;
  setupIntentId: string;
  planId: string;
  planSlug: string;
  stripePriceId: string;
  paymentDueAt: Date | null;
}): Promise<{ charged: boolean; hostedInvoiceUrl: string | null }> {
  const dueMs = input.paymentDueAt?.getTime() ?? 0;
  const chargeLater = dueMs > Date.now() + 120_000;
  const subscription = await input.stripe.subscriptions.create(
    {
      customer: input.customerId,
      items: [{ price: input.stripePriceId, quantity: 1 }],
      default_payment_method: input.paymentMethodId,
      metadata: {
        organizationId: input.organizationId,
        planId: input.planId,
        planSlug: input.planSlug,
      },
      ...(chargeLater ? { trial_end: Math.floor(dueMs / 1000) } : {}),
    },
    { idempotencyKey: `setup-sub:${input.organizationId}:${input.setupIntentId}` },
  );

  await syncSubscriptionFromStripe(subscription, input.organizationId);

  const invoiceId = stripeId(subscription.latest_invoice);
  if (!invoiceId) {
    return { charged: subscription.status === "active" || subscription.status === "trialing", hostedInvoiceUrl: null };
  }
  const invoice = await input.stripe.invoices.retrieve(invoiceId);
  return {
    charged: invoice.status === "paid" || subscription.status === "trialing",
    hostedInvoiceUrl: invoice.status === "open" ? (invoice.hosted_invoice_url ?? null) : null,
  };
}

export async function finalizePaymentMethodSetupBySessionId(input: {
  organizationId: string;
  sessionId: string;
  actorUserId?: string | null;
}): Promise<FinalizePaymentMethodSetupResult> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(input.sessionId);
  const sessionOrg = session.metadata?.organizationId?.trim();
  if (!sessionOrg || sessionOrg !== input.organizationId) {
    throw new BillingError("Setup session does not belong to this organization", "setup_session_mismatch");
  }
  return finalizePaymentMethodSetupSession(session, input.actorUserId);
}
