import { prisma } from "../../db.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import { listPlansForOrganization } from "./customPlanService.js";
import { findActiveCatalogPlanForTier } from "./planAssignment.js";
import {
  isAccessGrantingStatus,
  parsePlanFeatures,
  parsePlanLimitEnabledFlags,
  parsePlanLimits,
  subscriptionGrantsPaidPlanEntitlements,
  subscriptionHasStripeBilling,
  type PlanFeatures,
  type PlanLimits,
} from "./billingTypes.js";

export type EffectivePlanSnapshot = {
  organizationId: string;
  planId: string | null;
  planSlug: string | null;
  planName: string | null;
  pendingPlanId: string | null;
  pendingPlanName: string | null;
  legacyPlanTier: string;
  subscriptionStatus: string;
  hasAccess: boolean;
  inGracePeriod: boolean;
  grantsPaidEntitlements: boolean;
  limits: PlanLimits;
  /** false = limite desativado (oculto na UI, sem enforcement). */
  limitEnabled: Record<string, boolean>;
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
    customPlanAssignedAt: Date | null;
  } | null;
  gracePeriodDays: number;
  tierCatalogPlan: {
    id: string;
    slug: string;
    name: string;
    limits: unknown;
    features: unknown;
    legacyPlanTier: string | null;
  } | null;
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

  const grantsPaidEntitlements = subscriptionGrantsPaidPlanEntitlements({
    status,
    paymentDueAt: sub?.paymentDueAt ?? null,
    customPlanAssignedAt: sub?.customPlanAssignedAt ?? null,
  });
  const entitledPlan = grantsPaidEntitlements ? plan : null;
  const pendingPlan = !grantsPaidEntitlements && plan ? plan : null;

  const tierPlan = input.tierCatalogPlan;
  const limits = entitledPlan
    ? parsePlanLimits(entitledPlan.limits)
    : tierPlan
      ? parsePlanLimits(tierPlan.limits)
      : fallbackLimitsForTier(input.planTier);
  const limitEnabled = entitledPlan
    ? parsePlanLimitEnabledFlags(entitledPlan.limits)
    : tierPlan
      ? parsePlanLimitEnabledFlags(tierPlan.limits)
      : {};
  const features = entitledPlan
    ? parsePlanFeatures(entitledPlan.features)
    : tierPlan
      ? parsePlanFeatures(tierPlan.features)
      : fallbackFeaturesForTier(input.planTier);

  return {
    organizationId: input.organizationId,
    planId: entitledPlan?.id ?? null,
    planSlug: entitledPlan?.slug ?? tierPlan?.slug ?? input.planTier,
    planName: entitledPlan?.name ?? tierPlan?.name ?? input.planTier,
    pendingPlanId: pendingPlan?.id ?? null,
    pendingPlanName: pendingPlan?.name ?? null,
    legacyPlanTier: entitledPlan?.legacyPlanTier ?? input.planTier,
    subscriptionStatus: status,
    hasAccess,
    inGracePeriod,
    grantsPaidEntitlements,
    limits,
    limitEnabled,
    features,
    stripeManaged: sub
      ? subscriptionHasStripeBilling({
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
        })
      : false,
    currentPeriodEnd: grantsPaidEntitlements ? (sub?.currentPeriodEnd ?? null) : null,
    cancelAtPeriodEnd: grantsPaidEntitlements ? (sub?.cancelAtPeriodEnd ?? false) : false,
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
  const [org, settings, catalogPlans] = await Promise.all([
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
    listPlansForOrganization(organizationId),
  ]);

  if (!org) return null;

  const tierCatalogPlan = findActiveCatalogPlanForTier(catalogPlans, org.planTier);

  return buildSnapshotFromOrg({
    organizationId: org.id,
    planTier: org.planTier,
    subscription: org.subscription,
    gracePeriodDays: settings.gracePeriodDays,
    tierCatalogPlan: tierCatalogPlan
      ? {
          id: tierCatalogPlan.id,
          slug: tierCatalogPlan.slug,
          name: tierCatalogPlan.name,
          limits: tierCatalogPlan.limits,
          features: tierCatalogPlan.features,
          legacyPlanTier: tierCatalogPlan.legacyPlanTier,
        }
      : null,
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
