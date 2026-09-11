/** Estados internos alinhados ao ciclo Stripe (OrganizationSubscription.status). */
export const SUBSCRIPTION_STATUSES = [
  "inactive",
  "pending_payment",
  "trialing",
  "active",
  "past_due",
  "incomplete",
  "incomplete_expired",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Status que concedem acesso ao produto (antes de grace period). */
export const ACCESS_GRANTING_STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "pending_payment",
]);

export type PlanLimits = {
  agents?: number | null;
  automations?: number | null;
  contacts?: number | null;
  messages?: number | null;
};

export type PlanFeatures = {
  rag?: boolean;
  api?: boolean;
  mcp?: boolean;
};

export type BillingPlatformSettings = {
  /** Dias de tolerância após past_due antes de restringir acesso (Super Admin). */
  gracePeriodDays: number;
};

export function parsePlanLimits(raw: unknown): PlanLimits {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null | undefined => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return undefined;
  };
  return {
    agents: num(o.agents),
    automations: num(o.automations),
    contacts: num(o.contacts),
    messages: num(o.messages),
  };
}

export function parsePlanFeatures(raw: unknown): PlanFeatures {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    rag: o.rag === true,
    api: o.api === true,
    mcp: o.mcp === true,
  };
}

/** Mapeia status Stripe → status interno (fallback seguro). */
export function mapStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
    case "active":
    case "past_due":
    case "incomplete":
    case "incomplete_expired":
    case "canceled":
    case "unpaid":
    case "paused":
      return stripeStatus;
    default:
      return "inactive";
  }
}

export function isAccessGrantingStatus(status: string): boolean {
  return ACCESS_GRANTING_STATUSES.has(status as SubscriptionStatus);
}

/** Assinatura paga via Stripe (exclui plano free virtual sem customer). */
export function subscriptionHasStripeBilling(input: {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): boolean {
  return Boolean(input.stripeSubscriptionId?.trim() || input.stripeCustomerId?.trim());
}
