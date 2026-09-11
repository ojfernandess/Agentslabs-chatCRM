/** Limites reconhecidos pelo enforcement de billing (PlanEntitlementService / planEnforcement). */
export const KNOWN_PLAN_LIMIT_KEYS = ["agents", "automations", "contacts", "messages"] as const;

export type KnownPlanLimitKey = (typeof KNOWN_PLAN_LIMIT_KEYS)[number];

/** Feature flags reconhecidas pelo catálogo comercial. */
export const KNOWN_PLAN_FEATURE_KEYS = ["rag", "api", "mcp"] as const;

export type KnownPlanFeatureKey = (typeof KNOWN_PLAN_FEATURE_KEYS)[number];

/** Limites adicionais sugeridos (numéricos) — não têm enforcement até serem usados no runtime. */
export const SUGGESTED_PLAN_LIMIT_KEYS = [
  "seats",
  "users",
  "storage_gb",
  "channels",
  "workspaces",
] as const;

/** Feature flags comerciais sugeridas (além das reconhecidas pelo runtime). */
export const SUGGESTED_PLAN_FEATURE_KEYS = [
  "support",
  "priority_support",
  "dedicated_support",
  "custom_development",
  "onboarding",
  "sla",
  "white_label",
  "audit_logs",
] as const;

/** Campos textuais do plano (suporte, SLA descrito, pedidos de desenvolvimento, etc.). */
export const SUGGESTED_PLAN_EXTRA_KEYS = [
  "support",
  "development_requests",
  "sla",
  "onboarding",
  "included_services",
  "notes",
] as const;

export type SuggestedPlanExtraKey = (typeof SUGGESTED_PLAN_EXTRA_KEYS)[number];

export const ALL_CATALOG_FEATURE_KEYS = [
  ...KNOWN_PLAN_FEATURE_KEYS,
  ...SUGGESTED_PLAN_FEATURE_KEYS,
] as const;

export const ALL_CATALOG_LIMIT_KEYS = [
  ...KNOWN_PLAN_LIMIT_KEYS,
  ...SUGGESTED_PLAN_LIMIT_KEYS,
] as const;

export function parseLimitsObject(raw: unknown): Record<string, number | null> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function parseFeaturesObject(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function serializeLimits(limits: Record<string, number | null>): Record<string, number | null> {
  const sorted = Object.keys(limits).sort((a, b) => a.localeCompare(b));
  const out: Record<string, number | null> = {};
  for (const key of sorted) {
    if (limits[key] !== undefined) out[key] = limits[key];
  }
  return out;
}

export function serializeFeatures(features: Record<string, boolean>): Record<string, boolean> {
  const sorted = Object.keys(features).sort((a, b) => a.localeCompare(b));
  const out: Record<string, boolean> = {};
  for (const key of sorted) {
    if (key in features) out[key] = features[key] === true;
  }
  return out;
}

export function limitsToJson(limits: Record<string, number | null>): string {
  return JSON.stringify(serializeLimits(limits), null, 2);
}

export function featuresToJson(features: Record<string, boolean>): string {
  return JSON.stringify(serializeFeatures(features), null, 2);
}

export function isKnownLimitKey(key: string): key is KnownPlanLimitKey {
  return (KNOWN_PLAN_LIMIT_KEYS as readonly string[]).includes(key);
}

export function isKnownFeatureKey(key: string): key is KnownPlanFeatureKey {
  return (KNOWN_PLAN_FEATURE_KEYS as readonly string[]).includes(key);
}

export function isSuggestedFeatureKey(key: string): boolean {
  return (SUGGESTED_PLAN_FEATURE_KEYS as readonly string[]).includes(key);
}

export function isSuggestedLimitKey(key: string): boolean {
  return (SUGGESTED_PLAN_LIMIT_KEYS as readonly string[]).includes(key);
}

export function isSuggestedExtraKey(key: string): key is SuggestedPlanExtraKey {
  return (SUGGESTED_PLAN_EXTRA_KEYS as readonly string[]).includes(key);
}

export function parseExtrasObject(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function serializeExtras(extras: Record<string, string>): Record<string, string> {
  const sorted = Object.keys(extras).sort((a, b) => a.localeCompare(b));
  const out: Record<string, string> = {};
  for (const key of sorted) {
    const v = extras[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

export function extrasToJson(extras: Record<string, string>): string {
  return JSON.stringify(serializeExtras(extras), null, 2);
}

export function catalogFeatureLabelKey(key: string): string | null {
  if (isKnownFeatureKey(key)) return `superAdmin.billingFeatureKey_${key}`;
  if (isSuggestedFeatureKey(key)) return `superAdmin.billingSuggestedFeatureKey_${key}`;
  return null;
}

export function catalogLimitLabelKey(key: string): string | null {
  if (isKnownLimitKey(key)) return `superAdmin.billingLimitKey_${key}`;
  if (isSuggestedLimitKey(key)) return `superAdmin.billingSuggestedLimitKey_${key}`;
  return null;
}

export function catalogExtraLabelKey(key: string): string | null {
  if (isSuggestedExtraKey(key)) return `superAdmin.billingExtraKey_${key}`;
  return null;
}
