import { getWebAppPublicOrigin } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { BillingError, ensureStripeCustomer } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";

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
  const returnUrl =
    input.returnUrl?.trim() || `${base}/settings?section=billing&setup=success`;
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
  return `${getWebAppPublicOrigin()}/settings?section=billing&setup=success`;
}

export function getStripeSetupCancelUrl(): string {
  return `${getWebAppPublicOrigin()}/settings?section=billing&setup=cancel`;
}
