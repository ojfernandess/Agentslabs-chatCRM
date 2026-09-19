import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { assertCheckoutAllowed } from "./checkoutGuards.js";
import { CHECKOUT_PENDING_BILLING_RESET } from "./billingTypes.js";
import { resolveCatalogCheckoutPendingFields } from "./pendingCheckoutService.js";
import { BillingError, ensureStripeCustomer } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";
import { isStaleStripeBindingError } from "./stripeErrors.js";

export type CreateCheckoutSessionInput = {
  organizationId: string;
  planId: string;
  actorUserId: string;
  ip?: string | null;
};

export type CreateCheckoutSessionResult = {
  url: string;
  sessionId: string;
};

/**
 * Cria sessão Stripe Checkout — preço vem exclusivamente do plano no banco.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const plan = await prisma.plan.findFirst({
    where: { id: input.planId, isActive: true },
  });
  if (!plan) throw new BillingError("Plan not found or inactive", "plan_not_found");
  if (!plan.stripePriceId?.trim()) {
    throw new BillingError("Plan is not linked to a Stripe Price", "plan_not_stripe_ready");
  }
  if (plan.amountCents <= 0) {
    throw new BillingError("Free plans cannot use Stripe Checkout", "free_plan_checkout");
  }

  await assertCheckoutAllowed(input.organizationId, plan.id);

  const customerId = await ensureStripeCustomer(input.organizationId);
  const stripe = getStripeClient();

  const idempotencyKey = `checkout:${input.organizationId}:${plan.id}`;

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        success_url: config.stripeCheckoutSuccessUrl,
        cancel_url: config.stripeCheckoutCancelUrl,
        client_reference_id: input.organizationId,
        metadata: {
          organizationId: input.organizationId,
          planId: plan.id,
          planSlug: plan.slug,
        },
        subscription_data: {
          metadata: {
            organizationId: input.organizationId,
            planId: plan.id,
            planSlug: plan.slug,
          },
          ...(plan.trialDays && plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
        },
      },
      { idempotencyKey },
    );
  } catch (err) {
    if (isStaleStripeBindingError(err)) {
      throw new BillingError(
        "Plan Stripe Price/Product IDs are from test mode but live keys are configured (or the reverse). Update plan IDs in Super Admin billing.",
        "stripe_plan_mode_mismatch",
      );
    }
    throw err;
  }

  if (!session.url) {
    throw new BillingError("Stripe Checkout did not return a URL", "checkout_no_url");
  }

  const checkoutPending = await resolveCatalogCheckoutPendingFields(input.organizationId);

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      planId: plan.id,
      paymentProvider: "stripe",
      stripeCustomerId: customerId,
      stripePriceId: plan.stripePriceId,
      externalCustomerId: customerId,
      externalPriceId: plan.stripePriceId,
      status: "incomplete",
      checkoutSessionId: session.id,
      checkoutPreviousPlanId: checkoutPending.checkoutPreviousPlanId,
      paymentDueAt: checkoutPending.paymentDueAt,
    },
    update: {
      planId: plan.id,
      paymentProvider: "stripe",
      stripeCustomerId: customerId,
      stripePriceId: plan.stripePriceId,
      externalCustomerId: customerId,
      externalPriceId: plan.stripePriceId,
      status: "incomplete",
      checkoutSessionId: session.id,
      checkoutPreviousPlanId: checkoutPending.checkoutPreviousPlanId,
      paymentDueAt: checkoutPending.paymentDueAt,
      ...CHECKOUT_PENDING_BILLING_RESET,
    },
  });

  await recordBillingAudit({
    action: "billing.checkout_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: session.id,
    metadata: { planId: plan.id, planSlug: plan.slug },
    ip: input.ip,
  });

  return { url: session.url, sessionId: session.id };
}
