import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { mapStripeSubscriptionStatus } from "./billingTypes.js";
import { getSubscriptionBillingPeriod } from "./stripeHelpers.js";

function stripeUnixToDate(value: number | null | undefined): Date | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

async function resolvePlanIdFromStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metaPlanId = subscription.metadata?.planId?.trim();
  if (metaPlanId) {
    const byId = await prisma.plan.findUnique({ where: { id: metaPlanId }, select: { id: true } });
    if (byId) return byId.id;
  }

  const priceId = subscription.items.data[0]?.price?.id?.trim();
  if (priceId) {
    const byPrice = await prisma.plan.findFirst({
      where: { stripePriceId: priceId },
      select: { id: true },
    });
    if (byPrice) return byPrice.id;
  }

  return null;
}

export type SyncSubscriptionResult = {
  organizationId: string;
  planId: string | null;
  status: string;
};

/**
 * Persiste snapshot Stripe → OrganizationSubscription + plan_tier legado na Organization.
 */
export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  organizationIdHint?: string | null,
): Promise<SyncSubscriptionResult | null> {
  const organizationId =
    organizationIdHint?.trim() ||
    subscription.metadata?.organizationId?.trim() ||
    subscription.metadata?.opennexoOrgId?.trim() ||
    null;

  if (!organizationId) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    if (customerId) {
      const org = await prisma.organization.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      });
      if (org) return syncSubscriptionFromStripe(subscription, org.id);
    }
    return null;
  }

  const planId = await resolvePlanIdFromStripeSubscription(subscription);
  const status = mapStripeSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const period = getSubscriptionBillingPeriod(subscription);

  const subData: Prisma.OrganizationSubscriptionUncheckedUpdateInput = {
    organizationId,
    planId,
    stripeCustomerId: customerId ?? undefined,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    status,
    currentPeriodStart: stripeUnixToDate(period.currentPeriodStart),
    currentPeriodEnd: stripeUnixToDate(period.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    canceledAt: stripeUnixToDate(subscription.canceled_at),
    trialStart: stripeUnixToDate(subscription.trial_start),
    trialEnd: stripeUnixToDate(subscription.trial_end),
    checkoutSessionId: null,
  };

  await prisma.organizationSubscription.upsert({
    where: { organizationId },
    create: subData as Prisma.OrganizationSubscriptionUncheckedCreateInput,
    update: subData,
  });

  if (customerId) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customerId },
    });
  }

  if (planId) {
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      select: { legacyPlanTier: true, limits: true },
    });
    if (plan?.legacyPlanTier) {
      const orgUpdate: Prisma.OrganizationUpdateInput = { planTier: plan.legacyPlanTier };
      const limits = plan.limits as Record<string, unknown> | null;
      if (limits && typeof limits.messages === "number") {
        orgUpdate.monthlyMessageQuota = limits.messages;
      }
      await prisma.organization.update({ where: { id: organizationId }, data: orgUpdate });
    }
  }

  return { organizationId, planId, status };
}
