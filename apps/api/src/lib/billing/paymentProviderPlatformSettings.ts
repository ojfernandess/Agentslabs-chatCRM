import { prisma } from "../../db.js";
import { isMercadoPagoBillingConfigured, isStripeBillingConfigured } from "../../config.js";
import { resolvePlatformMercadoPagoAccessToken } from "./mercadoPagoBillingSettings.js";

export const PAYMENT_PROVIDERS_BILLING_KEY = "payment_providers_billing";

export type PaymentProviderToggle = {
  enabled: boolean;
};

export type PaymentProviderPlatformSettings = {
  stripe: PaymentProviderToggle;
  mercadopago: PaymentProviderToggle;
};

export type PaymentProviderPlatformDiagnostics = PaymentProviderPlatformSettings & {
  stripeReady: boolean;
  mercadopagoReady: boolean;
};

const DEFAULT_SETTINGS: PaymentProviderPlatformSettings = {
  stripe: { enabled: true },
  mercadopago: { enabled: true },
};

export function readPaymentProviderPlatformSettings(raw: unknown): PaymentProviderPlatformSettings {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const stripeRaw = o.stripe && typeof o.stripe === "object" ? (o.stripe as Record<string, unknown>) : {};
  const mpRaw =
    o.mercadopago && typeof o.mercadopago === "object" ? (o.mercadopago as Record<string, unknown>) : {};

  return {
    stripe: { enabled: stripeRaw.enabled !== false },
    mercadopago: { enabled: mpRaw.enabled !== false },
  };
}

export async function getPaymentProviderPlatformSettings(): Promise<PaymentProviderPlatformSettings> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PAYMENT_PROVIDERS_BILLING_KEY },
  });
  if (!row?.value) return DEFAULT_SETTINGS;
  return readPaymentProviderPlatformSettings(row.value);
}

export async function savePaymentProviderPlatformSettings(
  value: PaymentProviderPlatformSettings,
): Promise<PaymentProviderPlatformSettings> {
  const normalized = readPaymentProviderPlatformSettings(value);
  await prisma.platformSetting.upsert({
    where: { key: PAYMENT_PROVIDERS_BILLING_KEY },
    create: { key: PAYMENT_PROVIDERS_BILLING_KEY, value: normalized },
    update: { value: normalized },
  });
  return normalized;
}

export async function patchPaymentProviderPlatformSettings(input: {
  stripe?: Partial<PaymentProviderToggle>;
  mercadopago?: Partial<PaymentProviderToggle>;
}): Promise<PaymentProviderPlatformSettings> {
  const current = await getPaymentProviderPlatformSettings();
  return savePaymentProviderPlatformSettings({
    stripe: { enabled: input.stripe?.enabled ?? current.stripe.enabled },
    mercadopago: { enabled: input.mercadopago?.enabled ?? current.mercadopago.enabled },
  });
}

export async function isStripeBillingEnabledForCheckout(): Promise<boolean> {
  const settings = await getPaymentProviderPlatformSettings();
  return settings.stripe.enabled && isStripeBillingConfigured();
}

export async function isMercadoPagoBillingEnabledForCheckout(): Promise<boolean> {
  const settings = await getPaymentProviderPlatformSettings();
  if (!settings.mercadopago.enabled || !isMercadoPagoBillingConfigured()) return false;
  try {
    await resolvePlatformMercadoPagoAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function getPaymentProviderPlatformDiagnostics(): Promise<PaymentProviderPlatformDiagnostics> {
  const settings = await getPaymentProviderPlatformSettings();
  const [stripeReady, mercadopagoReady] = await Promise.all([
    isStripeBillingEnabledForCheckout(),
    isMercadoPagoBillingEnabledForCheckout(),
  ]);
  return {
    ...settings,
    stripeReady,
    mercadopagoReady,
  };
}
