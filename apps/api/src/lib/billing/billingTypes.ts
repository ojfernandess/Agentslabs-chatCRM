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
  /** Limites personalizados definidos no catálogo (ex.: seats). */
  [key: string]: number | null | undefined;
};

export type PlanFeatures = {
  rag?: boolean;
  api?: boolean;
  mcp?: boolean;
  /** Feature flags personalizadas definidas no catálogo. */
  [key: string]: boolean | undefined;
};

export type LimitEnforcementMode = "block" | "overage";

export type UsageDimensionKey = "agents" | "automations" | "contacts" | "messages";

export type DimensionOverageConfig = {
  /** Quando true, excedentes desta dimensão são reportados ao Stripe Meter (modo overage). */
  enabled: boolean;
  /** event_name do Billing Meter no Stripe (POST /v1/billing/meter_events). */
  stripeMeterEventName: string | null;
  /** Preço unitário de referência (centavos) — exibido na UI; cobrança real via preço metered Stripe. */
  unitAmountCents: number | null;
};

export type BillingPlatformSettings = {
  /** Dias de tolerância após past_due antes de restringir acesso (Super Admin). */
  gracePeriodDays: number;
  /** block = impede criação acima do limite; overage = permite e reporta meter events ao Stripe. */
  limitEnforcementMode: LimitEnforcementMode;
  overage: Record<UsageDimensionKey, DimensionOverageConfig>;
};

export function parsePlanLimits(raw: unknown): PlanLimits {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PlanLimits = {};
  for (const [key, value] of Object.entries(o)) {
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function parsePlanFeatures(raw: unknown): PlanFeatures {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PlanFeatures = {};
  for (const [key, value] of Object.entries(o)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export type PlanExtras = Record<string, string>;

export function parsePlanExtras(raw: unknown): PlanExtras {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PlanExtras = {};
  for (const [key, value] of Object.entries(o)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
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
