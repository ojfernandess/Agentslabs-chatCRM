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

export const PAYMENT_PROVIDER_NAMES = ["stripe", "mercadopago"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

export function isPaymentProviderName(value: string): value is PaymentProviderName {
  return (PAYMENT_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Status que concedem acesso ao produto (antes de grace period). */
export const ACCESS_GRANTING_STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "pending_payment",
]);

export const CORE_PLAN_LIMIT_KEYS = ["agents", "automations", "contacts", "messages"] as const;

export const SUGGESTED_PLAN_LIMIT_KEYS = [
  "seats",
  "users",
  "storage_gb",
  "channels",
  "workspaces",
] as const;

export const ALL_CATALOG_LIMIT_KEYS = [
  ...CORE_PLAN_LIMIT_KEYS,
  ...SUGGESTED_PLAN_LIMIT_KEYS,
] as const;

/** Metadado JSON em `plan.limits` — chaves com `false` ficam ocultas e sem enforcement. */
export const PLAN_LIMITS_ENABLED_KEY = "__enabled";

export type CorePlanLimitKey = (typeof CORE_PLAN_LIMIT_KEYS)[number];

export type PlanLimits = {
  agents?: number | null;
  automations?: number | null;
  contacts?: number | null;
  messages?: number | null;
  /** Limites personalizados definidos no catálogo (ex.: seats). */
  [key: string]: number | null | undefined;
};

export function orderPlanLimitKeys(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  const ordered: string[] = [];
  for (const key of CORE_PLAN_LIMIT_KEYS) {
    if (set.has(key)) ordered.push(key);
  }
  for (const key of [...set].sort((a, b) => a.localeCompare(b))) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

export type PlanFeatures = {
  rag?: boolean;
  api?: boolean;
  mcp?: boolean;
  /** Feature flags personalizadas definidas no catálogo. */
  [key: string]: boolean | undefined;
};

export type LimitEnforcementMode = "block" | "overage";

export type UsageDimensionKey = (typeof CORE_PLAN_LIMIT_KEYS)[number];

export function defaultOverageMeterEventName(key: string): string {
  const safe = key.replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_");
  return `openconduit_${safe}_overage`;
}

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
  /** Medidores Stripe por dimensão (catálogo + limites personalizados dos planos). */
  overage: Record<string, DimensionOverageConfig>;
};

export function parsePlanLimitEnabledFlags(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const enabledRaw = (raw as Record<string, unknown>)[PLAN_LIMITS_ENABLED_KEY];
  if (!enabledRaw || typeof enabledRaw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(enabledRaw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function isPlanLimitEnabled(key: string, flags: Record<string, boolean>): boolean {
  return flags[key] !== false;
}

export function parsePlanLimits(raw: unknown): PlanLimits {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PlanLimits = {};
  for (const [key, value] of Object.entries(o)) {
    if (key === PLAN_LIMITS_ENABLED_KEY) continue;
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

export type PlanPaymentProviders = {
  stripe: boolean;
  mercadopago: boolean;
};

export const PLAN_BILLING_STRIPE_KEY = "__billingStripe";
export const PLAN_BILLING_MERCADOPAGO_KEY = "__billingMercadopago";

/** Remove metadados internos de checkout antes de expor features ao catálogo/UI. */
export function stripInternalPlanFeatureKeys(features: PlanFeatures): PlanFeatures {
  const out: PlanFeatures = { ...features };
  delete out[PLAN_BILLING_STRIPE_KEY];
  delete out[PLAN_BILLING_MERCADOPAGO_KEY];
  return out;
}

export function parsePlanPaymentProviders(
  features: unknown,
  fallback?: {
    stripePriceId?: string | null;
    mercadopagoPlanId?: string | null;
    amountCents?: number;
  },
): PlanPaymentProviders {
  const flags = parsePlanFeatures(features);
  if (
    typeof flags[PLAN_BILLING_STRIPE_KEY] === "boolean" ||
    typeof flags[PLAN_BILLING_MERCADOPAGO_KEY] === "boolean"
  ) {
    return {
      stripe: flags[PLAN_BILLING_STRIPE_KEY] === true,
      mercadopago: flags[PLAN_BILLING_MERCADOPAGO_KEY] === true,
    };
  }

  if ((fallback?.amountCents ?? 0) > 0) {
    const hasStripe = Boolean(fallback?.stripePriceId?.trim());
    const hasMercadoPago = Boolean(fallback?.mercadopagoPlanId?.trim());
    if (hasStripe || hasMercadoPago) {
      return { stripe: hasStripe, mercadopago: hasMercadoPago };
    }
    return { stripe: true, mercadopago: true };
  }

  return { stripe: false, mercadopago: false };
}

export function applyPlanPaymentProvidersToFeatures(
  features: Record<string, unknown> | undefined,
  paymentProviders: PlanPaymentProviders,
): Record<string, unknown> {
  return {
    ...(features ?? {}),
    [PLAN_BILLING_STRIPE_KEY]: paymentProviders.stripe,
    [PLAN_BILLING_MERCADOPAGO_KEY]: paymentProviders.mercadopago,
  };
}

export function formatPlanExtraForDisplay(value: unknown, locale = "pt-BR"): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.billing === "free") {
    const description = typeof o.description === "string" ? o.description.trim() : "";
    return description || "Grátis";
  }
  if (o.billing === "paid" && typeof o.amountCents === "number" && Number.isFinite(o.amountCents)) {
    const currency = typeof o.currency === "string" && o.currency.trim() ? o.currency : "BRL";
    const formatted = new Intl.NumberFormat(locale, { style: "currency", currency }).format(o.amountCents / 100);
    const description = typeof o.description === "string" ? o.description.trim() : "";
    return description ? `${description} (${formatted})` : formatted;
  }
  return null;
}

export function parsePlanExtras(raw: unknown, locale = "pt-BR"): PlanExtras {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PlanExtras = {};
  for (const [key, value] of Object.entries(o)) {
    const formatted = formatPlanExtraForDisplay(value, locale);
    if (formatted) out[key] = formatted;
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

/** Mapeia status Mercado Pago preapproval → status interno. */
export function mapMercadoPagoPreapprovalStatus(mpStatus: string): SubscriptionStatus {
  switch (mpStatus.trim().toLowerCase()) {
    case "authorized":
      return "active";
    case "pending":
      return "incomplete";
    case "paused":
      return "paused";
    case "cancelled":
    case "canceled":
      return "canceled";
    default:
      return "inactive";
  }
}

/** Mapeia status Mercado Pago payment (Pix/cartão avulso) → status interno. */
export function mapMercadoPagoPaymentStatus(mpStatus: string): SubscriptionStatus {
  switch (mpStatus.trim().toLowerCase()) {
    case "approved":
      return "active";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "pending_payment";
    case "rejected":
    case "cancelled":
    case "canceled":
      return "incomplete";
    default:
      return "inactive";
  }
}

const SUBSCRIPTION_STATUS_PRECEDENCE: Record<SubscriptionStatus, number> = {
  active: 100,
  trialing: 100,
  past_due: 80,
  pending_payment: 60,
  paused: 55,
  incomplete: 40,
  incomplete_expired: 30,
  unpaid: 20,
  inactive: 10,
  canceled: 0,
};

const SUBSCRIPTION_TERMINAL_STATUSES = new Set<SubscriptionStatus>([
  "canceled",
  "paused",
  "past_due",
  "unpaid",
]);

function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Evita regressão de assinatura já activa (ex.: webhook MP "pending" após pagamento aprovado).
 * Estados terminais (cancelado, pausado, etc.) continuam a ser aplicados.
 */
export function resolveSubscriptionStatusUpdate(
  currentStatus: string,
  incomingStatus: SubscriptionStatus,
): SubscriptionStatus {
  if (SUBSCRIPTION_TERMINAL_STATUSES.has(incomingStatus)) {
    return incomingStatus;
  }

  const current = isSubscriptionStatus(currentStatus) ? currentStatus : "inactive";

  if (
    (current === "active" || current === "trialing") &&
    (incomingStatus === "pending_payment" ||
      incomingStatus === "incomplete" ||
      incomingStatus === "inactive" ||
      incomingStatus === "incomplete_expired")
  ) {
    return current;
  }

  const currentRank = SUBSCRIPTION_STATUS_PRECEDENCE[current] ?? 0;
  const incomingRank = SUBSCRIPTION_STATUS_PRECEDENCE[incomingStatus] ?? 0;
  return incomingRank >= currentRank ? incomingStatus : current;
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

/** Assinatura gerida por qualquer provedor externo (Stripe ou Mercado Pago). */
export function subscriptionHasExternalBilling(input: {
  paymentProvider?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}): boolean {
  if (input.externalSubscriptionId?.trim() || input.externalCustomerId?.trim()) return true;
  return subscriptionHasStripeBilling(input);
}

/** Assinatura com cobrança recorrente ativa no provedor externo. */
export function subscriptionIsProviderManaged(input: {
  paymentProvider?: string | null;
  stripeSubscriptionId?: string | null;
  externalSubscriptionId?: string | null;
}): boolean {
  // Mercado Pago (Pix / preapproval) não implementa changePlan no provider — checkout trata upgrades.
  if (input.paymentProvider === "mercadopago") return false;
  return Boolean(input.externalSubscriptionId?.trim() || input.stripeSubscriptionId?.trim());
}

/** Normaliza slug de plano para o formato aceito pela API (`a-z`, `0-9`, `-`). */
export function normalizePlanSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidPlanSlug(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 64 && /^[a-z0-9-]+$/.test(slug);
}
