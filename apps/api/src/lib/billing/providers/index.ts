import {
  assertProviderConfigured,
  getBillingProvider,
  getBillingProvidersClientConfig,
  listBillingProviderNames,
  resolveDefaultPaymentProvider,
  resolveOrganizationPaymentProvider,
} from "./BillingProviderFactory.js";
import { mercadoPagoBillingProvider } from "./mercadopago/MercadoPagoBillingProvider.js";
import { stripeBillingProvider } from "./stripe/StripeBillingProvider.js";

export * from "./types.js";
export * from "./BillingProviderFactory.js";
export { stripeBillingProvider, mercadoPagoBillingProvider };

export const billingProviders = {
  stripe: stripeBillingProvider,
  mercadopago: mercadoPagoBillingProvider,
  list: listBillingProviderNames,
  get: getBillingProvider,
  getClientConfig: getBillingProvidersClientConfig,
  resolveDefault: resolveDefaultPaymentProvider,
  resolveForOrganization: resolveOrganizationPaymentProvider,
  assertConfigured: assertProviderConfigured,
};
