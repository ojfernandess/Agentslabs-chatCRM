/** Limites reconhecidos pelo enforcement de billing (PlanEntitlementService / planEnforcement). */
export const KNOWN_PLAN_LIMIT_KEYS = ["agents", "automations", "contacts", "messages"] as const;

export type KnownPlanLimitKey = (typeof KNOWN_PLAN_LIMIT_KEYS)[number];

/** Feature flags reconhecidas pelo catálogo comercial. */
export const KNOWN_PLAN_FEATURE_KEYS = ["rag", "api", "mcp"] as const;

export type KnownPlanFeatureKey = (typeof KNOWN_PLAN_FEATURE_KEYS)[number];

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
