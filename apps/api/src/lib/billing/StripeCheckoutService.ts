import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { BillingError, ensureStripeCustomer } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";
import { isAccessGrantingStatus } from "./billingTypes.js";

const CHECKOUT_BLOCKING_STATUSES = new Set(["incomplete"]);

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

async function assertCheckoutAllowed(organizationId: string, targetPlanId: string): Promise<void> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: { select: { id: true, slug: true } } },
  });

  if (!sub) return;

  const awaitingStripePayment =
    sub.status === "pending_payment" && !sub.stripeSubscriptionId?.trim();

  if (
    sub.planId === targetPlanId &&
    isAccessGrantingStatus(sub.status) &&
    !awaitingStripePayment
  ) {
    throw new BillingError("Organization already has an active subscription for this plan", "already_subscribed");
  }

  if (isAccessGrantingStatus(sub.status) && sub.stripeSubscriptionId) {
    throw new BillingError(
      "Use plan change flow for an existing paid subscription",
      "subscription_exists",
    );
  }

  if (CHECKOUT_BLOCKING_STATUSES.has(sub.status) && sub.checkoutSessionId) {
    throw new BillingError("Checkout already in progress for this organization", "checkout_in_progress");
  }
}

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

  const session = await stripe.checkout.sessions.create(
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

  if (!session.url) {
    throw new BillingError("Stripe Checkout did not return a URL", "checkout_no_url");
  }

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      planId: plan.id,
      stripeCustomerId: customerId,
      stripePriceId: plan.stripePriceId,
      status: "incomplete",
      checkoutSessionId: session.id,
    },
    update: {
      planId: plan.id,
      stripeCustomerId: customerId,
      stripePriceId: plan.stripePriceId,
      status: "incomplete",
      checkoutSessionId: session.id,
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
