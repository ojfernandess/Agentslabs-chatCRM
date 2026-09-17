import { isStripeBillingConfigured } from "../../../../config.js";
import { getStripePublishableKeyForClient } from "../../StripePortalService.js";
import { createCheckoutSession } from "../../StripeCheckoutService.js";
import { createBillingPortalSession } from "../../StripePortalService.js";
import {
  cancelOrganizationSubscription,
  changeSubscriptionPlan,
  resumeScheduledCancellation,
} from "../../StripeSubscriptionService.js";
import { listOrganizationInvoices } from "../../StripeInvoiceService.js";
import {
  createPaymentMethodPortalSession,
  createPaymentMethodSetupSession,
} from "../../StripeSetupService.js";
import {
  getPaymentProviderPlatformSettings,
  isStripeBillingEnabledForCheckout,
} from "../../paymentProviderPlatformSettings.js";
import {
  STRIPE_BILLING_CAPABILITIES,
  type BillingProvider,
  type BillingProviderConfigSlice,
  type ProviderContext,
} from "../types.js";

function assertStripeConfigured(): void {
  if (!isStripeBillingConfigured()) {
    throw new Error("Stripe billing is not configured on this server");
  }
}

async function assertStripeEnabledForCheckout(): Promise<void> {
  if (!(await isStripeBillingEnabledForCheckout())) {
    throw new Error("Stripe billing is disabled or not configured on this platform");
  }
}

export const stripeBillingProvider: BillingProvider = {
  name: "stripe",
  capabilities: STRIPE_BILLING_CAPABILITIES,

  async isConfigured(_ctx?: ProviderContext): Promise<boolean> {
    return isStripeBillingEnabledForCheckout();
  },

  async getClientConfig(_ctx?: ProviderContext): Promise<BillingProviderConfigSlice> {
    const toggles = await getPaymentProviderPlatformSettings();
    const checkoutReady = await isStripeBillingEnabledForCheckout();
    return {
      configured: checkoutReady,
      connected: checkoutReady,
      enabled: toggles.stripe.enabled,
      publishableKey: getStripePublishableKeyForClient(),
      capabilities: STRIPE_BILLING_CAPABILITIES,
    };
  },

  async createCheckoutSession(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    return createCheckoutSession(input);
  },

  async createPortalSession(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    return createBillingPortalSession(input);
  },

  async changePlan(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    await changeSubscriptionPlan(input);
  },

  async cancelSubscription(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    await cancelOrganizationSubscription(input);
  },

  async resumeSubscription(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    await resumeScheduledCancellation(input);
  },

  async listInvoices(organizationId) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    return listOrganizationInvoices(organizationId);
  },

  async createPaymentMethodSetupSession(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    return createPaymentMethodSetupSession(input);
  },

  async createPaymentMethodPortalSession(input) {
    await assertStripeEnabledForCheckout();
    assertStripeConfigured();
    return createPaymentMethodPortalSession(input);
  },
};
