import { prisma } from "../../db.js";
import type { BillingPlatformSettings } from "./billingTypes.js";

export const BILLING_PLATFORM_KEY = "stripe_billing";

const DEFAULT_SETTINGS: BillingPlatformSettings = {
  gracePeriodDays: 7,
};

export function readBillingPlatformSettings(raw: unknown): BillingPlatformSettings {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const graceRaw = o.gracePeriodDays;
  let gracePeriodDays = DEFAULT_SETTINGS.gracePeriodDays;
  if (typeof graceRaw === "number" && Number.isFinite(graceRaw)) {
    gracePeriodDays = Math.max(0, Math.min(90, Math.floor(graceRaw)));
  }
  return { gracePeriodDays };
}

export async function getBillingPlatformSettings(): Promise<BillingPlatformSettings> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: BILLING_PLATFORM_KEY },
  });
  return readBillingPlatformSettings(row?.value);
}

export async function saveBillingPlatformSettings(value: BillingPlatformSettings): Promise<void> {
  const normalized = readBillingPlatformSettings(value);
  await prisma.platformSetting.upsert({
    where: { key: BILLING_PLATFORM_KEY },
    create: { key: BILLING_PLATFORM_KEY, value: normalized },
    update: { value: normalized },
  });
}
