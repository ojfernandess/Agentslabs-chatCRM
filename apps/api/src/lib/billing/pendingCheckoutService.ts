import { prisma } from "../../db.js";
import { recordBillingAudit } from "./billingAudit.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import { subscriptionGrantsPaidPlanEntitlements } from "./billingTypes.js";
import { isAwaitingStripePayment, listPlansForOrganization } from "./customPlanService.js";
import { findActiveCatalogPlanForTier } from "./planAssignment.js";

export type CatalogCheckoutPendingFields = {
  checkoutPreviousPlanId: string | null;
  paymentDueAt: Date;
};

/** Resolve plano anterior e prazo ao iniciar checkout de catálogo (self-service). */
export async function resolveCatalogCheckoutPendingFields(
  organizationId: string,
): Promise<CatalogCheckoutPendingFields> {
  const [settings, sub, org, catalogPlans] = await Promise.all([
    getBillingPlatformSettings(),
    prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: {
        planId: true,
        status: true,
        paymentDueAt: true,
        customPlanAssignedAt: true,
        checkoutPreviousPlanId: true,
      },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { planTier: true },
    }),
    listPlansForOrganization(organizationId),
  ]);

  const tierPlan = findActiveCatalogPlanForTier(catalogPlans, org?.planTier ?? "free");
  const grantsPaid = subscriptionGrantsPaidPlanEntitlements({
    status: sub?.status ?? "inactive",
    paymentDueAt: sub?.paymentDueAt ?? null,
    customPlanAssignedAt: sub?.customPlanAssignedAt ?? null,
  });

  let checkoutPreviousPlanId: string | null = null;
  if (grantsPaid && sub?.planId) {
    checkoutPreviousPlanId = sub.planId;
  } else if (sub?.checkoutPreviousPlanId) {
    checkoutPreviousPlanId = sub.checkoutPreviousPlanId;
  } else {
    checkoutPreviousPlanId = tierPlan?.id ?? null;
  }

  return {
    checkoutPreviousPlanId,
    paymentDueAt: new Date(Date.now() + settings.checkoutExpirationHours * 3_600_000),
  };
}

function resolveCheckoutDueAt(
  paymentDueAt: Date | null,
  updatedAt: Date,
  checkoutExpirationHours: number,
): Date {
  if (paymentDueAt) return paymentDueAt;
  return new Date(updatedAt.getTime() + checkoutExpirationHours * 3_600_000);
}

/** Reverte checkout expirado ao plano anterior e limpa estado pendente. */
export async function expirePendingCheckoutIfNeeded(organizationId: string): Promise<boolean> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      id: true,
      planId: true,
      status: true,
      paymentProvider: true,
      stripeSubscriptionId: true,
      externalSubscriptionId: true,
      paymentDueAt: true,
      updatedAt: true,
      customPlanAssignedAt: true,
      checkoutPreviousPlanId: true,
      checkoutSessionId: true,
    },
  });

  if (
    sub &&
    !sub.customPlanAssignedAt &&
    isAwaitingStripePayment({ status: sub.status, stripeSubscriptionId: sub.stripeSubscriptionId })
  ) {
    const settings = await getBillingPlatformSettings();
    const dueAt = resolveCheckoutDueAt(sub.paymentDueAt, sub.updatedAt, settings.checkoutExpirationHours);
    if (dueAt.getTime() > Date.now()) return false;

    const [org, catalogPlans] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { planTier: true },
      }),
      listPlansForOrganization(organizationId),
    ]);

    const restorePlanId =
      sub.checkoutPreviousPlanId ??
      findActiveCatalogPlanForTier(catalogPlans, org?.planTier ?? "free")?.id ??
      null;
    const restorePlan = restorePlanId
      ? (catalogPlans.find((plan) => plan.id === restorePlanId) ?? null)
      : null;

    const hasPaidProviderSubscription = Boolean(sub.stripeSubscriptionId?.trim());
    let nextStatus = "inactive";
    if (restorePlan && restorePlan.amountCents <= 0) {
      nextStatus = "active";
    } else if (hasPaidProviderSubscription) {
      nextStatus = "active";
    }

    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: {
        planId: restorePlanId,
        status: nextStatus,
        checkoutSessionId: null,
        paymentDueAt: null,
        checkoutPreviousPlanId: null,
        ...(sub.paymentProvider === "mercadopago" && !hasPaidProviderSubscription
          ? { externalSubscriptionId: null }
          : {}),
      },
    });

    await recordBillingAudit({
      action: "billing.checkout_expired",
      organizationId,
      resourceId: sub.id,
      metadata: {
        previousPendingPlanId: sub.planId,
        restoredPlanId: restorePlanId,
        checkoutSessionId: sub.checkoutSessionId,
      },
    });

    return true;
  }

  return false;
}
