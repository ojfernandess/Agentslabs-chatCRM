import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { getStripeClient } from "./stripeClient.js";
import { syncSubscriptionFromStripe } from "./subscriptionSync.js";
import { getEventOrganizationId, getInvoiceSubscriptionId } from "./stripeHelpers.js";

export class StripeWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "StripeWebhookError";
  }
}

/** Valida assinatura e constrói evento Stripe (raw body). */
export function constructStripeWebhookEvent(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): Stripe.Event {
  const webhookSecret =
    config.stripeWebhookSecret.trim() || process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (!webhookSecret) {
    throw new StripeWebhookError("STRIPE_WEBHOOK_SECRET is not configured", 500);
  }
  if (!signatureHeader?.trim()) {
    throw new StripeWebhookError("Missing Stripe-Signature header", 400);
  }
  try {
    const stripe = getStripeClient();
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid webhook signature";
    throw new StripeWebhookError(msg, 400);
  }
}

async function markEventProcessed(event: Stripe.Event): Promise<boolean> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return false;
    throw err;
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const organizationId = session.metadata?.organizationId?.trim() || session.client_reference_id?.trim();
  if (!organizationId) return;

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return;

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscriptionFromStripe(subscription, organizationId);

  await recordBillingAudit({
    action: "billing.subscription_created",
    organizationId,
    metadata: { checkoutSessionId: session.id, subscriptionId },
  });
}

async function handleSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const result = await syncSubscriptionFromStripe(subscription);
  if (!result) return;

  if (subscription.status === "canceled") {
    await recordBillingAudit({
      action: "billing.subscription_canceled",
      organizationId: result.organizationId,
      metadata: { subscriptionId: subscription.id, status: subscription.status },
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const organizationId = await resolveOrganizationIdFromInvoice(invoice);
  if (!organizationId) return;

  await recordBillingAudit({
    action: "billing.payment_succeeded",
    organizationId,
    resourceId: invoice.id,
    metadata: {
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      subscriptionId: getInvoiceSubscriptionId(invoice),
    },
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const organizationId = await resolveOrganizationIdFromInvoice(invoice);
  if (!organizationId) return;

  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (subscriptionId) {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscriptionFromStripe(subscription, organizationId);
  }

  await recordBillingAudit({
    action: "billing.payment_failed",
    organizationId,
    resourceId: invoice.id,
    metadata: {
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      subscriptionId,
    },
  });
}

async function resolveOrganizationIdFromInvoice(invoice: Stripe.Invoice): Promise<string | null> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return null;

  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return org?.id ?? null;
}

const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.subscription.trial_will_end",
]);

/**
 * Processa evento Stripe com idempotência (PK = event.id).
 * Retorna false se evento já foi processado.
 */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<boolean> {
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return true;
  }

  const isNew = await markEventProcessed(event);
  if (!isNew) return false;

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end":
      await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
    case "invoice.payment_action_required":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }

  const organizationId = getEventOrganizationId(event);
  if (organizationId) {
    await recordBillingAudit({
      action: "billing.webhook_processed",
      organizationId,
      stripeEventId: event.id,
      metadata: { type: event.type },
    });
  }

  return true;
}
