import { config } from "../../../../config.js";
import { BillingError } from "../../StripeCustomerService.js";
import {
  getMercadoPagoBillingPlatformSettings,
  resolveMercadoPagoPublicKeyForMode,
} from "../../mercadoPagoBillingSettings.js";
import {
  getPaymentProviderPlatformSettings,
  isMercadoPagoBillingEnabledForCheckout,
} from "../../paymentProviderPlatformSettings.js";
import {
  MERCADOPAGO_BILLING_CAPABILITIES,
  type BillingProvider,
  type BillingProviderConfigSlice,
  type ProviderContext,
} from "../types.js";
import { createMercadoPagoCheckoutSession } from "../../mercadopago/MercadoPagoCheckoutService.js";

function mercadoPagoNotConfiguredError(): BillingError {
  return new BillingError(
    "Mercado Pago billing is not enabled or not configured on the platform. Enable it in Super Admin → Integrações de pagamento and configure MERCADOPAGO_* tokens.",
    "mercadopago_not_configured",
  );
}

function mercadoPagoUnsupportedOperation(operation: string): never {
  throw new BillingError(
    `Mercado Pago ${operation} is not available in platform-managed billing. Use checkout to change plans or contact support.`,
    "mercadopago_not_configured",
  );
}

export const mercadoPagoBillingProvider: BillingProvider = {
  name: "mercadopago",
  capabilities: MERCADOPAGO_BILLING_CAPABILITIES,

  async isConfigured(_ctx?: ProviderContext): Promise<boolean> {
    return isMercadoPagoBillingEnabledForCheckout();
  },

  async getClientConfig(_ctx?: ProviderContext): Promise<BillingProviderConfigSlice> {
    const toggles = await getPaymentProviderPlatformSettings();
    const mpSettings = await getMercadoPagoBillingPlatformSettings();
    const platformPublishableKey =
      resolveMercadoPagoPublicKeyForMode(mpSettings.mode) || config.mercadopagoPublicKey || null;
    const checkoutReady = await isMercadoPagoBillingEnabledForCheckout();

    return {
      configured: checkoutReady,
      connected: checkoutReady,
      enabled: toggles.mercadopago.enabled,
      publishableKey: platformPublishableKey,
      capabilities: MERCADOPAGO_BILLING_CAPABILITIES,
    };
  },

  async createCheckoutSession(input) {
    if (!(await this.isConfigured({ organizationId: input.organizationId }))) {
      throw mercadoPagoNotConfiguredError();
    }
    return createMercadoPagoCheckoutSession(input);
  },

  async createPortalSession() {
    mercadoPagoUnsupportedOperation("customer portal");
  },

  async changePlan() {
    mercadoPagoUnsupportedOperation("plan change");
  },

  async cancelSubscription() {
    mercadoPagoUnsupportedOperation("subscription cancel");
  },

  async resumeSubscription() {
    mercadoPagoUnsupportedOperation("subscription resume");
  },

  async listInvoices() {
    mercadoPagoUnsupportedOperation("invoice listing");
  },

  async createPaymentMethodSetupSession() {
    mercadoPagoUnsupportedOperation("payment method setup");
  },

  async createPaymentMethodPortalSession() {
    mercadoPagoUnsupportedOperation("payment method portal");
  },
};

export async function mercadoPagoAccessTokenForOrganization(_organizationId: string): Promise<string | null> {
  return null;
}
