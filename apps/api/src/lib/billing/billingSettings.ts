import { prisma } from "../../db.js";
import type { BillingPlatformSettings, DimensionOverageConfig } from "./billingTypes.js";
import { ALL_CATALOG_LIMIT_KEYS } from "./billingTypes.js";

export const BILLING_PLATFORM_KEY = "stripe_billing";

const DEFAULT_OVERAGE_DIMENSION: DimensionOverageConfig = {
  enabled: false,
  stripeMeterEventName: null,
  unitAmountCents: null,
};

function buildDefaultOverage(): Record<string, DimensionOverageConfig> {
  const out: Record<string, DimensionOverageConfig> = {};
  for (const key of ALL_CATALOG_LIMIT_KEYS) {
    out[key] = { ...DEFAULT_OVERAGE_DIMENSION };
  }
  return out;
}

export const DEFAULT_BILLING_PLATFORM_SETTINGS: BillingPlatformSettings = {
  gracePeriodDays: 7,
  limitEnforcementMode: "block",
  overage: buildDefaultOverage(),
};

function readOverageDimension(raw: unknown): DimensionOverageConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const unitRaw = o.unitAmountCents;
  let unitAmountCents: number | null = null;
  if (typeof unitRaw === "number" && Number.isFinite(unitRaw)) {
    unitAmountCents = Math.max(0, Math.floor(unitRaw));
  }
  const meterName = typeof o.stripeMeterEventName === "string" ? o.stripeMeterEventName.trim() : "";
  return {
    enabled: o.enabled === true,
    stripeMeterEventName: meterName || null,
    unitAmountCents,
  };
}

function readOverageConfig(raw: unknown): BillingPlatformSettings["overage"] {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = buildDefaultOverage();
  for (const key of ALL_CATALOG_LIMIT_KEYS) {
    if (key in o) out[key] = readOverageDimension(o[key]);
  }
  for (const [key, value] of Object.entries(o)) {
    if (key in out) continue;
    if (typeof key === "string" && key.trim()) {
      out[key] = readOverageDimension(value);
    }
  }
  return out;
}

export function readBillingPlatformSettings(raw: unknown): BillingPlatformSettings {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const graceRaw = o.gracePeriodDays;
  let gracePeriodDays = DEFAULT_BILLING_PLATFORM_SETTINGS.gracePeriodDays;
  if (typeof graceRaw === "number" && Number.isFinite(graceRaw)) {
    gracePeriodDays = Math.max(0, Math.min(90, Math.floor(graceRaw)));
  }

  const modeRaw = o.limitEnforcementMode;
  const limitEnforcementMode =
    modeRaw === "overage" ? "overage" : DEFAULT_BILLING_PLATFORM_SETTINGS.limitEnforcementMode;

  return {
    gracePeriodDays,
    limitEnforcementMode,
    overage: readOverageConfig(o.overage),
  };
}

export async function getBillingPlatformSettings(): Promise<BillingPlatformSettings> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: BILLING_PLATFORM_KEY },
  });
  return readBillingPlatformSettings(row?.value ?? DEFAULT_BILLING_PLATFORM_SETTINGS);
}

export async function saveBillingPlatformSettings(value: BillingPlatformSettings): Promise<void> {
  const normalized = readBillingPlatformSettings(value);
  await prisma.platformSetting.upsert({
    where: { key: BILLING_PLATFORM_KEY },
    create: { key: BILLING_PLATFORM_KEY, value: normalized },
    update: { value: normalized },
  });
}

export type BillingPlatformSettingsPatch = {
  gracePeriodDays?: number;
  limitEnforcementMode?: BillingPlatformSettings["limitEnforcementMode"];
  overage?: Partial<Record<string, Partial<DimensionOverageConfig>>>;
};

/** Merge partial patch sobre settings actuais (evita apagar chaves ao PATCH parcial). */
export async function patchBillingPlatformSettings(
  patch: BillingPlatformSettingsPatch,
): Promise<BillingPlatformSettings> {
  const current = await getBillingPlatformSettings();
  const merged: BillingPlatformSettings = {
    ...current,
    ...patch,
    overage: { ...current.overage },
  };
  if (patch.overage) {
    for (const [key, patchDim] of Object.entries(patch.overage)) {
      if (!patchDim) continue;
      merged.overage[key] = readOverageDimension({
        ...(current.overage[key] ?? DEFAULT_OVERAGE_DIMENSION),
        ...patchDim,
      });
    }
  }
  await saveBillingPlatformSettings(merged);
  return readBillingPlatformSettings(merged);
}
