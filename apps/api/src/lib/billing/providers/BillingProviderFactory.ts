import { prisma } from "../../../db.js";
import {
  PAYMENT_PROVIDER_NAMES,
  type PaymentProviderName,
} from "../billingTypes.js";
import { mercadoPagoBillingProvider } from "./mercadopago/MercadoPagoBillingProvider.js";
import { stripeBillingProvider } from "./stripe/StripeBillingProvider.js";
import type { BillingProvider, BillingProviderConfigSlice, ProviderContext } from "./types.js";

const PROVIDERS: Record<PaymentProviderName, BillingProvider> = {
  stripe: stripeBillingProvider,
  mercadopago: mercadoPagoBillingProvider,
};

export function getBillingProvider(name: PaymentProviderName): BillingProvider {
  return PROVIDERS[name];
}

export function listBillingProviderNames(): readonly PaymentProviderName[] {
  return PAYMENT_PROVIDER_NAMES;
}

export function resolveDefaultPaymentProvider(): PaymentProviderName {
  return "stripe";
}

export async function resolveOrganizationPaymentProvider(
  organizationId: string,
): Promise<PaymentProviderName> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      paymentProvider: true,
      externalSubscriptionId: true,
      stripeSubscriptionId: true,
    },
  });
  if (sub?.paymentProvider === "mercadopago" || sub?.paymentProvider === "stripe") {
    return sub.paymentProvider;
  }
  if (sub?.externalSubscriptionId?.trim() || sub?.stripeSubscriptionId?.trim()) {
    return "stripe";
  }
  return resolveDefaultPaymentProvider();
}

export async function getBillingProvidersClientConfig(
  organizationId?: string,
): Promise<Record<PaymentProviderName, BillingProviderConfigSlice>> {
  const ctx: ProviderContext | undefined = organizationId ? { organizationId } : undefined;
  const entries = await Promise.all(
    PAYMENT_PROVIDER_NAMES.map(async (name) => {
      const provider = getBillingProvider(name);
      const slice = await provider.getClientConfig(ctx);
      return [name, slice] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<PaymentProviderName, BillingProviderConfigSlice>;
}

export async function assertProviderConfigured(
  providerName: PaymentProviderName,
  organizationId: string,
): Promise<BillingProvider> {
  const provider = getBillingProvider(providerName);
  const configured = await provider.isConfigured({ organizationId });
  if (!configured) {
    const { BillingError } = await import("../StripeCustomerService.js");
    throw new BillingError(
      `${providerName} billing is not configured`,
      `${providerName}_not_configured`,
    );
  }
  return provider;
}
