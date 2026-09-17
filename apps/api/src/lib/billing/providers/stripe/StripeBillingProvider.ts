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

export const stripeBillingProvider: BillingProvider = {
  name: "stripe",
  capabilities: STRIPE_BILLING_CAPABILITIES,

  isConfigured(_ctx?: ProviderContext): boolean {
    return isStripeBillingConfigured();
  },

  getClientConfig(_ctx?: ProviderContext): BillingProviderConfigSlice {
    const configured = isStripeBillingConfigured();
    return {
      configured,
      connected: configured,
      publishableKey: getStripePublishableKeyForClient(),
      capabilities: STRIPE_BILLING_CAPABILITIES,
    };
  },

  async createCheckoutSession(input) {
    assertStripeConfigured();
    return createCheckoutSession(input);
  },

  async createPortalSession(input) {
    assertStripeConfigured();
    return createBillingPortalSession(input);
  },

  async changePlan(input) {
    assertStripeConfigured();
    await changeSubscriptionPlan(input);
  },

  async cancelSubscription(input) {
    assertStripeConfigured();
    await cancelOrganizationSubscription(input);
  },

  async resumeSubscription(input) {
    assertStripeConfigured();
    await resumeScheduledCancellation(input);
  },

  async listInvoices(organizationId) {
    assertStripeConfigured();
    return listOrganizationInvoices(organizationId);
  },

  async createPaymentMethodSetupSession(input) {
    assertStripeConfigured();
    return createPaymentMethodSetupSession(input);
  },

  async createPaymentMethodPortalSession(input) {
    assertStripeConfigured();
    return createPaymentMethodPortalSession(input);
  },
};
