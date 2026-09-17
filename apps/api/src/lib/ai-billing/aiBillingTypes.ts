export const AI_BILLING_MODES = ["OWN_API_KEY", "PLATFORM_CREDITS"] as const;

export type AiBillingMode = (typeof AI_BILLING_MODES)[number];

export function isAiBillingMode(value: string | null | undefined): value is AiBillingMode {
  return value === "OWN_API_KEY" || value === "PLATFORM_CREDITS";
}

export function normalizeAiBillingMode(value: string | null | undefined): AiBillingMode {
  return isAiBillingMode(value) ? value : "OWN_API_KEY";
}
