import { prisma } from "../../db.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import {
  isAccessGrantingStatus,
  parsePlanFeatures,
  parsePlanLimits,
  subscriptionHasStripeBilling,
  type PlanFeatures,
  type PlanLimits,
} from "./billingTypes.js";

export type EffectivePlanSnapshot = {
  organizationId: string;
  planId: string | null;
  planSlug: string | null;
  planName: string | null;
  legacyPlanTier: string;
  subscriptionStatus: string;
  hasAccess: boolean;
  inGracePeriod: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
  stripeManaged: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

function buildSnapshotFromOrg(input: {
  organizationId: string;
  planTier: string;
  subscription: {
    status: string;
    plan: {
      id: string;
      slug: string;
      name: string;
      limits: unknown;
      features: unknown;
      legacyPlanTier: string | null;
      isCustom?: boolean;
    } | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    updatedAt: Date;
    paymentDueAt: Date | null;
  } | null;
  gracePeriodDays: number;
}): EffectivePlanSnapshot {
  const sub = input.subscription;
  const plan = sub?.plan ?? null;
  const status = sub?.status ?? "inactive";
  const granting = isAccessGrantingStatus(status);

  let inGracePeriod = false;
  if (status === "past_due" && sub && input.gracePeriodDays > 0) {
    const graceEnds = new Date(sub.updatedAt.getTime() + input.gracePeriodDays * 86_400_000);
    inGracePeriod = graceEnds.getTime() > Date.now();
  }

  let pendingPaymentGrace = false;
  if (status === "pending_payment" && sub?.paymentDueAt) {
    pendingPaymentGrace = sub.paymentDueAt.getTime() > Date.now();
    inGracePeriod = pendingPaymentGrace;
  }

  const hasAccess =
    granting &&
    (status !== "past_due" || inGracePeriod) &&
    (status !== "pending_payment" || pendingPaymentGrace);

  const limits = plan ? parsePlanLimits(plan.limits) : fallbackLimitsForTier(input.planTier);
  const features = plan ? parsePlanFeatures(plan.features) : fallbackFeaturesForTier(input.planTier);

  return {
    organizationId: input.organizationId,
    planId: plan?.id ?? null,
    planSlug: plan?.slug ?? input.planTier,
    planName: plan?.name ?? input.planTier,
    legacyPlanTier: plan?.legacyPlanTier ?? input.planTier,
    subscriptionStatus: status,
    hasAccess,
    inGracePeriod,
    limits,
    features,
    stripeManaged: sub
      ? subscriptionHasStripeBilling({
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
        })
      : false,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  };
}

function fallbackLimitsForTier(tier: string): PlanLimits {
  switch (tier) {
    case "growth":
      return { agents: 10, automations: 50, contacts: 10_000, messages: 50_000 };
    case "enterprise":
      return { agents: null, automations: null, contacts: null, messages: null };
    default:
      return { agents: 3, automations: 10, contacts: 1000, messages: null };
  }
}

function fallbackFeaturesForTier(tier: string): PlanFeatures {
  switch (tier) {
    case "growth":
      return { rag: true, api: true, mcp: false };
    case "enterprise":
      return { rag: true, api: true, mcp: true };
    default:
      return { rag: false, api: false, mcp: false };
  }
}

/** Plano efetivo + limites para uma organização (fonte única para enforcement futuro). */
export async function getEffectivePlanForOrganization(
  organizationId: string,
): Promise<EffectivePlanSnapshot | null> {
  const [org, settings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        planTier: true,
        subscription: {
          include: {
            plan: {
              select: {
                id: true,
                slug: true,
                name: true,
                limits: true,
                features: true,
                legacyPlanTier: true,
                isCustom: true,
              },
            },
          },
        },
      },
    }),
    getBillingPlatformSettings(),
  ]);

  if (!org) return null;

  return buildSnapshotFromOrg({
    organizationId: org.id,
    planTier: org.planTier,
    subscription: org.subscription,
    gracePeriodDays: settings.gracePeriodDays,
  });
}

/** Verifica se organização tem acesso ativo (considera grace period). */
export async function organizationHasBillingAccess(organizationId: string): Promise<boolean> {
  const snap = await getEffectivePlanForOrganization(organizationId);
  return snap?.hasAccess ?? false;
}

/** Limite numérico ou null (= ilimitado). */
export function resolveLimitValue(limit: number | null | undefined): number | null {
  if (limit === null) return null;
  if (typeof limit === "number" && Number.isFinite(limit)) return limit;
  return null;
}
