import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  mapStripeSubscriptionStatus,
  type PaymentProviderName,
  type SubscriptionStatus,
} from "./billingTypes.js";
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

export type SubscriptionSnapshotInput = {
  organizationId: string;
  planId: string | null;
  paymentProvider: PaymentProviderName;
  status: SubscriptionStatus;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  externalPriceId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  checkoutSessionId?: string | null;
  clearPaymentDue?: boolean;
};

/**
 * Persiste snapshot provider-agnostic → OrganizationSubscription + plan_tier legado.
 */
export async function syncSubscriptionSnapshot(
  input: SubscriptionSnapshotInput,
): Promise<SyncSubscriptionResult> {
  const subData: Prisma.OrganizationSubscriptionUncheckedUpdateInput = {
    organizationId: input.organizationId,
    planId: input.planId,
    paymentProvider: input.paymentProvider,
    externalCustomerId: input.externalCustomerId ?? undefined,
    externalSubscriptionId: input.externalSubscriptionId ?? undefined,
    externalPriceId: input.externalPriceId ?? undefined,
    stripeCustomerId: input.stripeCustomerId ?? undefined,
    stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
    stripePriceId: input.stripePriceId ?? undefined,
    status: input.status,
    currentPeriodStart: input.currentPeriodStart ?? undefined,
    currentPeriodEnd: input.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    canceledAt: input.canceledAt ?? undefined,
    trialStart: input.trialStart ?? undefined,
    trialEnd: input.trialEnd ?? undefined,
    checkoutSessionId: input.checkoutSessionId ?? undefined,
    ...(input.clearPaymentDue ? { paymentDueAt: null } : {}),
  };

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: subData as Prisma.OrganizationSubscriptionUncheckedCreateInput,
    update: subData,
  });

  const customerId = input.externalCustomerId ?? input.stripeCustomerId;
  if (customerId) {
    const orgUpdate: Prisma.OrganizationUpdateInput = {};
    if (input.paymentProvider === "stripe") {
      orgUpdate.stripeCustomerId = customerId;
    }
    if (Object.keys(orgUpdate).length > 0) {
      await prisma.organization.update({
        where: { id: input.organizationId },
        data: orgUpdate,
      });
    }
  }

  if (input.planId) {
    const plan = await prisma.plan.findUnique({
      where: { id: input.planId },
      select: { legacyPlanTier: true, limits: true },
    });
    if (plan?.legacyPlanTier) {
      const orgUpdate: Prisma.OrganizationUpdateInput = { planTier: plan.legacyPlanTier };
      const limits = plan.limits as Record<string, unknown> | null;
      if (limits && typeof limits.messages === "number") {
        orgUpdate.monthlyMessageQuota = limits.messages;
      }
      await prisma.organization.update({ where: { id: input.organizationId }, data: orgUpdate });
    }
  }

  return { organizationId: input.organizationId, planId: input.planId, status: input.status };
}

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

  return syncSubscriptionSnapshot({
    organizationId,
    planId,
    paymentProvider: "stripe",
    status,
    externalCustomerId: customerId,
    externalSubscriptionId: subscription.id,
    externalPriceId: priceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodStart: stripeUnixToDate(period.currentPeriodStart),
    currentPeriodEnd: stripeUnixToDate(period.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    canceledAt: stripeUnixToDate(subscription.canceled_at),
    trialStart: stripeUnixToDate(subscription.trial_start),
    trialEnd: stripeUnixToDate(subscription.trial_end),
    checkoutSessionId: null,
    clearPaymentDue: status === "active" || status === "trialing",
  });
}
