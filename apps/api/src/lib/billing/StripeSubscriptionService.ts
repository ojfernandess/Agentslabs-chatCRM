import { prisma } from "../../db.js";
import { recordBillingAudit } from "./billingAudit.js";
import { clearOrganizationStripeBindings } from "./clearStripeBindings.js";
import { BillingError } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";
import { syncSubscriptionFromStripe } from "./subscriptionSync.js";
import { isAccessGrantingStatus } from "./billingTypes.js";
import { isStaleStripeBindingError } from "./stripeErrors.js";

const STRIPE_MODE_MISMATCH_MESSAGE =
  "Stripe subscription is from test mode but live keys are configured (or the reverse). Clear Stripe bindings and complete checkout again.";

async function retrieveStripeSubscriptionOrReset(
  organizationId: string,
  stripeSubscriptionId: string,
): Promise<Awaited<ReturnType<ReturnType<typeof getStripeClient>["subscriptions"]["retrieve"]>>> {
  const stripe = getStripeClient();
  try {
    return await stripe.subscriptions.retrieve(stripeSubscriptionId);
  } catch (err) {
    if (!isStaleStripeBindingError(err)) throw err;
    await clearOrganizationStripeBindings(organizationId);
    throw new BillingError(STRIPE_MODE_MISMATCH_MESSAGE, "stripe_mode_mismatch");
  }
}

async function mutateStripeSubscriptionOrReset<T>(
  organizationId: string,
  stripeSubscriptionId: string,
  mutate: () => Promise<T>,
): Promise<T> {
  try {
    return await mutate();
  } catch (err) {
    if (!isStaleStripeBindingError(err)) throw err;
    await clearOrganizationStripeBindings(organizationId);
    throw new BillingError(STRIPE_MODE_MISMATCH_MESSAGE, "stripe_mode_mismatch");
  }
}

export type ChangePlanInput = {
  organizationId: string;
  planId: string;
  actorUserId: string;
  ip?: string | null;
};

export type CancelSubscriptionInput = {
  organizationId: string;
  actorUserId: string;
  cancelAtPeriodEnd?: boolean;
  ip?: string | null;
};

/**
 * Upgrade/downgrade via Stripe Subscription update (proration default do Stripe).
 */
export async function changeSubscriptionPlan(input: ChangePlanInput): Promise<void> {
  const plan = await prisma.plan.findFirst({
    where: { id: input.planId, isActive: true },
  });
  if (!plan) throw new BillingError("Plan not found or inactive", "plan_not_found");
  if (!plan.stripePriceId?.trim()) {
    throw new BillingError("Plan is not linked to a Stripe Price", "plan_not_stripe_ready");
  }

  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!sub?.stripeSubscriptionId) {
    throw new BillingError("No Stripe subscription to update — use checkout", "no_stripe_subscription");
  }
  if (!isAccessGrantingStatus(sub.status) && sub.status !== "past_due") {
    throw new BillingError("Subscription is not in a changeable state", "invalid_subscription_state");
  }

  const stripeSub = await retrieveStripeSubscriptionOrReset(
    input.organizationId,
    sub.stripeSubscriptionId,
  );
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new BillingError("Stripe subscription has no line item", "stripe_item_missing");

  const updated = await mutateStripeSubscriptionOrReset(
    input.organizationId,
    sub.stripeSubscriptionId,
    () =>
      getStripeClient().subscriptions.update(sub.stripeSubscriptionId!, {
        items: [{ id: itemId, price: plan.stripePriceId! }],
        metadata: {
          ...stripeSub.metadata,
          organizationId: input.organizationId,
          planId: plan.id,
          planSlug: plan.slug,
        },
        proration_behavior: "create_prorations",
      }),
  );

  await syncSubscriptionFromStripe(updated, input.organizationId);

  await recordBillingAudit({
    action: "billing.plan_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: sub.stripeSubscriptionId,
    metadata: { fromPlanId: sub.planId, toPlanId: plan.id, planSlug: plan.slug },
    ip: input.ip,
  });
}

/** Cancelamento — por defeito ao fim do período (cancel_at_period_end). */
export async function cancelOrganizationSubscription(input: CancelSubscriptionInput): Promise<void> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!sub?.stripeSubscriptionId) {
    throw new BillingError("No Stripe subscription to cancel", "no_stripe_subscription");
  }

  const cancelAtPeriodEnd = input.cancelAtPeriodEnd !== false;

  const updated = await mutateStripeSubscriptionOrReset(
    input.organizationId,
    sub.stripeSubscriptionId,
    () => {
      const stripe = getStripeClient();
      return cancelAtPeriodEnd
        ? stripe.subscriptions.update(sub.stripeSubscriptionId!, { cancel_at_period_end: true })
        : stripe.subscriptions.cancel(sub.stripeSubscriptionId!);
    },
  );

  await syncSubscriptionFromStripe(updated, input.organizationId);

  await recordBillingAudit({
    action: "billing.subscription_canceled",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: sub.stripeSubscriptionId,
    metadata: { cancelAtPeriodEnd },
    ip: input.ip,
  });
}

/** Reativa cancelamento agendado (cancel_at_period_end = false). */
export async function resumeScheduledCancellation(input: {
  organizationId: string;
  actorUserId: string;
  ip?: string | null;
}): Promise<void> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (!sub?.stripeSubscriptionId) {
    throw new BillingError("No Stripe subscription", "no_stripe_subscription");
  }

  const updated = await mutateStripeSubscriptionOrReset(
    input.organizationId,
    sub.stripeSubscriptionId,
    () =>
      getStripeClient().subscriptions.update(sub.stripeSubscriptionId!, {
        cancel_at_period_end: false,
      }),
  );
  await syncSubscriptionFromStripe(updated, input.organizationId);

  await recordBillingAudit({
    action: "billing.plan_changed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: sub.stripeSubscriptionId,
    metadata: { resumedCancellation: true },
    ip: input.ip,
  });
}
