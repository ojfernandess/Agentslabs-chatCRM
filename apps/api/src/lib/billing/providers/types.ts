import type { BillingInvoiceRow } from "../StripeInvoiceService.js";
import type { PaymentProviderName } from "../billingTypes.js";

export type { PaymentProviderName };

export interface BillingProviderCapabilities {
  subscriptions: boolean;
  pix: boolean;
  creditCard: boolean;
  checkout: boolean;
  qrCode: boolean;
  refunds: boolean;
  pauseSubscription: boolean;
  resumeSubscription: boolean;
  billingPortal: boolean;
}

export interface ProviderContext {
  organizationId: string;
}

export interface BillingProviderConfigSlice {
  configured: boolean;
  connected: boolean;
  publishableKey: string | null;
  capabilities: BillingProviderCapabilities;
}

export interface CreateCheckoutSessionInput {
  organizationId: string;
  planId: string;
  actorUserId: string;
  ip?: string | null;
}

export interface CreateCheckoutSessionResult {
  url: string;
  sessionId: string;
}

export interface PortalSessionInput {
  organizationId: string;
  actorUserId: string;
  returnUrl?: string;
  ip?: string | null;
}

export interface ChangePlanInput {
  organizationId: string;
  planId: string;
  actorUserId: string;
  ip?: string | null;
}

export interface CancelSubscriptionInput {
  organizationId: string;
  actorUserId: string;
  cancelAtPeriodEnd?: boolean;
  ip?: string | null;
}

export interface ResumeSubscriptionInput {
  organizationId: string;
  actorUserId: string;
  ip?: string | null;
}

export interface BillingProvider {
  readonly name: PaymentProviderName;
  readonly capabilities: BillingProviderCapabilities;

  isConfigured(ctx?: ProviderContext): boolean | Promise<boolean>;
  getClientConfig(ctx?: ProviderContext): BillingProviderConfigSlice | Promise<BillingProviderConfigSlice>;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  changePlan(input: ChangePlanInput): Promise<void>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<void>;
  resumeSubscription(input: ResumeSubscriptionInput): Promise<void>;
  listInvoices(organizationId: string): Promise<BillingInvoiceRow[]>;
  createPaymentMethodSetupSession(input: PortalSessionInput): Promise<{ url: string }>;
  createPaymentMethodPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
}

export const STRIPE_BILLING_CAPABILITIES: BillingProviderCapabilities = {
  subscriptions: true,
  pix: false,
  creditCard: true,
  checkout: true,
  qrCode: false,
  refunds: true,
  pauseSubscription: true,
  resumeSubscription: true,
  billingPortal: true,
};

export const MERCADOPAGO_BILLING_CAPABILITIES: BillingProviderCapabilities = {
  subscriptions: true,
  pix: true,
  creditCard: true,
  checkout: true,
  qrCode: true,
  refunds: true,
  pauseSubscription: false,
  resumeSubscription: false,
  billingPortal: false,
};
