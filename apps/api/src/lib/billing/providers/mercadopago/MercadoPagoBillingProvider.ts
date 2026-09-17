import { prisma } from "../../../../db.js";
import { config, isMercadoPagoBillingConfigured } from "../../../../config.js";
import { BillingError } from "../../StripeCustomerService.js";
import {
  isMercadoPagoConnectedForOrganizationSync,
  resolveMercadoPagoAccessToken,
} from "../../MercadoPagoConnectionService.js";
import {
  getMercadoPagoBillingPlatformSettings,
  resolveMercadoPagoPublicKeyForMode,
} from "../../mercadoPagoBillingSettings.js";
import {
  MERCADOPAGO_BILLING_CAPABILITIES,
  type BillingProvider,
  type BillingProviderConfigSlice,
  type CreateCheckoutSessionInput,
  type CreateCheckoutSessionResult,
  type ProviderContext,
} from "../types.js";
import { createMercadoPagoCheckoutSession } from "../../mercadopago/MercadoPagoCheckoutService.js";

function notConfigured(): never {
  throw new BillingError(
    "Mercado Pago billing is not configured for this organization",
    "mercadopago_not_configured",
  );
}

async function resolveOrgConnection(organizationId: string) {
  return prisma.paymentProviderConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "mercadopago" },
    },
    select: {
      status: true,
      accessTokenEnc: true,
      publicKey: true,
    },
  });
}

export const mercadoPagoBillingProvider: BillingProvider = {
  name: "mercadopago",
  capabilities: MERCADOPAGO_BILLING_CAPABILITIES,

  async isConfigured(ctx?: ProviderContext): Promise<boolean> {
    if (isMercadoPagoBillingConfigured()) return true;
    if (!ctx?.organizationId) return false;
    const conn = await resolveOrgConnection(ctx.organizationId);
    return isMercadoPagoConnectedForOrganizationSync(conn);
  },

  async getClientConfig(ctx?: ProviderContext): Promise<BillingProviderConfigSlice> {
    const platformConfigured = isMercadoPagoBillingConfigured();
    const conn = ctx?.organizationId ? await resolveOrgConnection(ctx.organizationId) : null;
    const orgConnected = isMercadoPagoConnectedForOrganizationSync(conn);
    const mpSettings = await getMercadoPagoBillingPlatformSettings();
    const platformPublishableKey = resolveMercadoPagoPublicKeyForMode(mpSettings.mode) || config.mercadopagoPublicKey || null;
    return {
      configured: platformConfigured || orgConnected,
      connected: platformConfigured || orgConnected,
      publishableKey: conn?.publicKey?.trim() || platformPublishableKey,
      capabilities: MERCADOPAGO_BILLING_CAPABILITIES,
    };
  },

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    const configured = await this.isConfigured({ organizationId: input.organizationId });
    if (!configured) notConfigured();
    return createMercadoPagoCheckoutSession(input);
  },

  async createPortalSession() {
    notConfigured();
  },

  async changePlan() {
    notConfigured();
  },

  async cancelSubscription() {
    notConfigured();
  },

  async resumeSubscription() {
    notConfigured();
  },

  async listInvoices() {
    notConfigured();
  },

  async createPaymentMethodSetupSession() {
    notConfigured();
  },

  async createPaymentMethodPortalSession() {
    notConfigured();
  },
};

export async function mercadoPagoAccessTokenForOrganization(organizationId: string): Promise<string | null> {
  return resolveMercadoPagoAccessToken(organizationId);
}
