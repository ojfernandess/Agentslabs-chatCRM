import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AiCreditPackage, AiCreditPurchase } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { config, getPublicOrigin } from "../../config.js";
import { prisma } from "../../db.js";
import { recordBillingAudit } from "../billing/billingAudit.js";
import type { PaymentProviderName } from "../billing/billingTypes.js";
import { getBillingProvidersClientConfig, resolveDefaultPaymentProvider } from "../billing/index.js";
import { BillingError, ensureStripeCustomer } from "../billing/StripeCustomerService.js";
import { getStripeClient } from "../billing/stripeClient.js";
import { isStaleStripeBindingError } from "../billing/stripeErrors.js";
import {
  buildMercadoPagoPixPayer,
  getMercadoPagoPayment,
} from "../billing/mercadopago/MercadoPagoPixPaymentService.js";
import {
  assertMercadoPagoAccessTokenMatchesBillingMode,
  mercadoPagoRequest,
  resolveMercadoPagoAccessTokenForBilling,
} from "../billing/mercadopago/mercadoPagoClient.js";
import {
  getMercadoPagoBillingPlatformSettings,
  MERCADOPAGO_SANDBOX_PIX_PAYER_FIRST_NAME,
  resolveMercadoPagoSandboxPayerEmail,
} from "../billing/mercadoPagoBillingSettings.js";
import { resolveBillingEmail } from "../billing/billingEmailRecipients.js";
import type { CheckoutPixDetails } from "../billing/providers/types.js";
import { getOrganizationAiBillingMode } from "./getOrganizationAiBillingMode.js";
import { creditAiWallet } from "./AiWalletService.js";
import { money, moneyToApiString } from "./money.js";

export const AI_CREDITS_CHECKOUT_MODE = "ai_credits";
export const AI_CREDITS_EXTERNAL_REFERENCE_PREFIX = "ONX-AI-";

type MercadoPagoPayment = {
  id: number | string;
  status?: string;
  status_detail?: string;
  date_of_expiration?: string | null;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

export type CreateAiCreditCheckoutInput = {
  organizationId: string;
  packageId: string;
  actorUserId: string;
  provider?: PaymentProviderName;
  paymentMethod?: "card" | "pix";
  payerIdentificationNumber?: string | null;
  ip?: string | null;
};

export type AiCreditCheckoutResult = {
  purchaseId: string;
  provider: PaymentProviderName;
  url: string;
  sessionId: string;
  mode: "redirect" | "pix";
  pix?: CheckoutPixDetails;
};

export type AiCreditCheckoutStatusResult = {
  purchaseId: string;
  sessionId: string;
  status: string;
  approved: boolean;
  walletBalance?: string;
};

export class AiCreditPurchaseError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_platform_credits"
      | "package_not_found"
      | "provider_not_configured"
      | "billing_email_missing"
      | "checkout_not_found"
      | "mercadopago_pix_document_required",
  ) {
    super(message);
    this.name = "AiCreditPurchaseError";
  }
}

function pixExpirationIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function mercadoPagoPixNotificationUrl(): string {
  return `${getPublicOrigin()}/webhooks/mercadopago`;
}

function extractPixDetails(payment: MercadoPagoPayment): CheckoutPixDetails {
  const txData = payment.point_of_interaction?.transaction_data;
  const qrCode = txData?.qr_code?.trim();
  const qrCodeBase64 = txData?.qr_code_base64?.trim();
  if (!qrCode || !qrCodeBase64) {
    throw new BillingError("Mercado Pago did not return Pix QR data", "mercadopago_pix_qr_missing");
  }
  return {
    qrCode,
    qrCodeBase64,
    ticketUrl: txData?.ticket_url?.trim() || null,
    expiresAt: payment.date_of_expiration ?? null,
  };
}

async function assertPlatformCreditsPurchaseAllowed(organizationId: string) {
  const mode = await getOrganizationAiBillingMode(organizationId);
  if (mode !== "PLATFORM_CREDITS") {
    throw new AiCreditPurchaseError(
      "AI credits purchase is only available in PLATFORM_CREDITS mode",
      "not_platform_credits",
    );
  }
}

async function resolveAiCreditCheckoutProvider(
  organizationId: string,
  requested?: PaymentProviderName,
): Promise<PaymentProviderName> {
  const providers = await getBillingProvidersClientConfig(organizationId);
  if (requested) {
    if (requested === "stripe" && (!providers.stripe.configured || !providers.stripe.enabled)) {
      throw new AiCreditPurchaseError("Stripe billing is not configured", "provider_not_configured");
    }
    if (
      requested === "mercadopago" &&
      (!providers.mercadopago.connected || !providers.mercadopago.enabled)
    ) {
      throw new AiCreditPurchaseError("Mercado Pago billing is not configured", "provider_not_configured");
    }
    return requested;
  }

  const stripeReady = providers.stripe.configured && providers.stripe.enabled;
  const mercadoPagoReady = providers.mercadopago.connected && providers.mercadopago.enabled;
  if (mercadoPagoReady && !stripeReady) return "mercadopago";
  if (stripeReady && !mercadoPagoReady) return "stripe";
  return resolveDefaultPaymentProvider();
}

async function resolvePayerEmail(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { billingEmail: true },
  });
  const email = org?.billingEmail?.trim() || (await resolveBillingEmail(organizationId));
  if (!email) {
    throw new AiCreditPurchaseError(
      "Billing email is required before checkout",
      "billing_email_missing",
    );
  }
  return email;
}

async function createPendingPurchase(input: {
  organizationId: string;
  pkg: AiCreditPackage;
  provider: PaymentProviderName;
  externalReference?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AiCreditPurchase> {
  const purchaseAttemptId = randomUUID();
  return prisma.aiCreditPurchase.create({
    data: {
      organizationId: input.organizationId,
      packageId: input.pkg.id,
      paymentProvider: input.provider,
      status: "PENDING",
      externalReference: input.externalReference ?? null,
      creditAmount: input.pkg.creditAmount,
      amountCents: input.pkg.amountCents,
      currency: input.pkg.currency,
      idempotencyKey: `ai-credit-checkout:${input.organizationId}:${input.pkg.id}:${purchaseAttemptId}`,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function createAiCreditPurchaseCheckout(
  input: CreateAiCreditCheckoutInput,
): Promise<AiCreditCheckoutResult> {
  await assertPlatformCreditsPurchaseAllowed(input.organizationId);

  const pkg = await prisma.aiCreditPackage.findFirst({
    where: { id: input.packageId, isActive: true },
  });
  if (!pkg || pkg.amountCents <= 0) {
    throw new AiCreditPurchaseError("AI credit package not found or inactive", "package_not_found");
  }

  const provider = await resolveAiCreditCheckoutProvider(input.organizationId, input.provider);
  if (provider === "mercadopago" && input.paymentMethod === "pix") {
    return createMercadoPagoAiCreditPixCheckout(input, pkg);
  }
  if (provider === "stripe") {
    return createStripeAiCreditCheckout(input, pkg);
  }
  if (provider === "mercadopago") {
    throw new AiCreditPurchaseError(
      "Mercado Pago AI credits checkout currently supports Pix only",
      "provider_not_configured",
    );
  }
  throw new AiCreditPurchaseError("No payment provider configured for AI credits", "provider_not_configured");
}

async function createStripeAiCreditCheckout(
  input: CreateAiCreditCheckoutInput,
  pkg: AiCreditPackage,
): Promise<AiCreditCheckoutResult> {
  const purchase = await createPendingPurchase({
    organizationId: input.organizationId,
    pkg,
    provider: "stripe",
    metadata: { checkoutMode: AI_CREDITS_CHECKOUT_MODE },
  });

  const customerId = await ensureStripeCustomer(input.organizationId);
  const stripe = getStripeClient();
  const idempotencyKey = purchase.idempotencyKey;

  const lineItem = pkg.stripePriceId?.trim()
    ? { price: pkg.stripePriceId.trim(), quantity: 1 }
    : {
        price_data: {
          currency: pkg.currency.toLowerCase(),
          unit_amount: pkg.amountCents,
          product_data: {
            name: pkg.name,
            description: pkg.description ?? undefined,
          },
        },
        quantity: 1,
      };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        line_items: [lineItem],
        success_url: `${config.stripeCheckoutSuccessUrl}${config.stripeCheckoutSuccessUrl.includes("?") ? "&" : "?"}ai_credits=success`,
        cancel_url: `${config.stripeCheckoutCancelUrl}${config.stripeCheckoutCancelUrl.includes("?") ? "&" : "?"}ai_credits=cancel`,
        client_reference_id: input.organizationId,
        metadata: {
          organizationId: input.organizationId,
          packageId: pkg.id,
          purchaseId: purchase.id,
          checkoutMode: AI_CREDITS_CHECKOUT_MODE,
          creditAmount: moneyToApiString(pkg.creditAmount),
        },
      },
      { idempotencyKey },
    );
  } catch (err) {
    await prisma.aiCreditPurchase.update({
      where: { id: purchase.id },
      data: { status: "FAILED" },
    });
    if (isStaleStripeBindingError(err)) {
      throw new BillingError(
        "Stripe Price IDs are from test mode but live keys are configured (or the reverse).",
        "stripe_plan_mode_mismatch",
      );
    }
    throw err;
  }

  if (!session.url) {
    throw new BillingError("Stripe Checkout did not return a URL", "checkout_no_url");
  }

  await prisma.aiCreditPurchase.update({
    where: { id: purchase.id },
    data: { checkoutSessionId: session.id },
  });

  await recordBillingAudit({
    action: "billing.ai_credits.checkout_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: purchase.id,
    metadata: {
      packageId: pkg.id,
      provider: "stripe",
      sessionId: session.id,
      creditAmount: moneyToApiString(pkg.creditAmount),
    },
    ip: input.ip,
  });

  return {
    purchaseId: purchase.id,
    provider: "stripe",
    url: session.url,
    sessionId: session.id,
    mode: "redirect",
  };
}

async function createMercadoPagoAiCreditPixCheckout(
  input: CreateAiCreditCheckoutInput,
  pkg: AiCreditPackage,
): Promise<AiCreditCheckoutResult> {
  const billingSettings = await getMercadoPagoBillingPlatformSettings();
  const accessToken = await resolveMercadoPagoAccessTokenForBilling(input.organizationId, null);
  await assertMercadoPagoAccessTokenMatchesBillingMode(accessToken, billingSettings.mode);

  let payerEmail = await resolvePayerEmail(input.organizationId);
  const sandboxMode = billingSettings.mode === "sandbox";
  if (sandboxMode) {
    payerEmail = resolveMercadoPagoSandboxPayerEmail(payerEmail);
  }

  const checkoutAttemptId = randomUUID();
  const externalReference = `${AI_CREDITS_EXTERNAL_REFERENCE_PREFIX}${input.organizationId}-${checkoutAttemptId}`;
  const purchase = await createPendingPurchase({
    organizationId: input.organizationId,
    pkg,
    provider: "mercadopago",
    externalReference,
    metadata: { checkoutMode: AI_CREDITS_CHECKOUT_MODE, paymentMethod: "pix" },
  });

  const payer = buildMercadoPagoPixPayer(
    payerEmail,
    input.payerIdentificationNumber,
    sandboxMode ? { firstName: MERCADOPAGO_SANDBOX_PIX_PAYER_FIRST_NAME, lastName: "Test" } : undefined,
  );

  const payment = await mercadoPagoRequest<MercadoPagoPayment>({
    accessToken,
    method: "POST",
    path: "/v1/payments",
    billingMode: billingSettings.mode,
    body: {
      transaction_amount: Number((pkg.amountCents / 100).toFixed(2)),
      description: pkg.name.trim(),
      payment_method_id: "pix",
      payer,
      external_reference: externalReference,
      notification_url: mercadoPagoPixNotificationUrl(),
      date_of_expiration: pixExpirationIso(),
      metadata: {
        organizationId: input.organizationId,
        packageId: pkg.id,
        purchaseId: purchase.id,
        checkoutMode: AI_CREDITS_CHECKOUT_MODE,
        creditAmount: moneyToApiString(pkg.creditAmount),
      },
    },
    idempotencyKey: `ai-credit-pix:${input.organizationId}:${pkg.id}:${checkoutAttemptId}`,
  });

  const sessionId = String(payment.id ?? "").trim();
  if (!sessionId) {
    await prisma.aiCreditPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
    throw new BillingError("Mercado Pago did not return a payment id", "mercadopago_pix_checkout_failed");
  }

  const pix = extractPixDetails(payment);
  await prisma.aiCreditPurchase.update({
    where: { id: purchase.id },
    data: { checkoutSessionId: sessionId },
  });

  await recordBillingAudit({
    action: "billing.ai_credits.checkout_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: purchase.id,
    metadata: {
      packageId: pkg.id,
      provider: "mercadopago",
      paymentMethod: "pix",
      sessionId,
      externalReference,
    },
    ip: input.ip,
  });

  return {
    purchaseId: purchase.id,
    provider: "mercadopago",
    url: pix.ticketUrl ?? "",
    sessionId,
    mode: "pix",
    pix,
  };
}

export async function fulfillAiCreditPurchase(input: {
  purchaseId: string;
  paymentReference: string;
  provider: PaymentProviderName;
}): Promise<{ alreadyCompleted: boolean; walletBalance: string }> {
  const purchase = await prisma.aiCreditPurchase.findUnique({
    where: { id: input.purchaseId },
    include: { package: true },
  });
  if (!purchase) {
    throw new AiCreditPurchaseError("AI credit purchase not found", "checkout_not_found");
  }
  if (purchase.status === "COMPLETED") {
    const wallet = await prisma.organizationAiWallet.findUnique({
      where: { organizationId: purchase.organizationId },
    });
    return {
      alreadyCompleted: true,
      walletBalance: moneyToApiString(wallet?.balance ?? money(0)),
    };
  }

  const walletCreditKey = `ai-credit-purchase:${purchase.id}`;
  const wallet = await creditAiWallet({
    organizationId: purchase.organizationId,
    amount: purchase.creditAmount,
    entryType: "CREDIT_PURCHASE",
    idempotencyKey: walletCreditKey,
    referenceType: "ai_credit_purchase",
    referenceId: input.paymentReference,
    metadata: {
      packageId: purchase.packageId,
      packageSlug: purchase.package.slug,
      provider: input.provider,
      amountCents: purchase.amountCents,
      currency: purchase.currency,
    },
  });

  await prisma.aiCreditPurchase.update({
    where: { id: purchase.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      checkoutSessionId: purchase.checkoutSessionId ?? input.paymentReference,
    },
  });

  await recordBillingAudit({
    action: "billing.ai_credits.purchase_completed",
    organizationId: purchase.organizationId,
    resourceId: purchase.id,
    metadata: {
      packageId: purchase.packageId,
      provider: input.provider,
      paymentReference: input.paymentReference,
      creditAmount: moneyToApiString(purchase.creditAmount),
      walletBalance: moneyToApiString(wallet.balance),
    },
  });

  return { alreadyCompleted: false, walletBalance: moneyToApiString(wallet.balance) };
}

export function isAiCreditsMercadoPagoExternalReference(
  externalReference: string | null | undefined,
): boolean {
  return externalReference?.trim().startsWith(AI_CREDITS_EXTERNAL_REFERENCE_PREFIX) ?? false;
}

export function isAiCreditsMercadoPagoPayment(payment: MercadoPagoPayment): boolean {
  if (payment.metadata?.checkoutMode === AI_CREDITS_CHECKOUT_MODE) return true;
  return isAiCreditsMercadoPagoExternalReference(payment.external_reference);
}

async function resolveAiCreditPurchaseIdFromMercadoPagoPayment(
  payment: MercadoPagoPayment,
): Promise<string | null> {
  const fromMeta =
    typeof payment.metadata?.purchaseId === "string" ? payment.metadata.purchaseId.trim() : "";
  if (fromMeta) return fromMeta;

  const sessionId = String(payment.id ?? "").trim();
  if (sessionId) {
    const bySession = await prisma.aiCreditPurchase.findFirst({
      where: { checkoutSessionId: sessionId },
      select: { id: true },
    });
    if (bySession) return bySession.id;
  }

  const externalReference = payment.external_reference?.trim();
  if (externalReference) {
    const byReference = await prisma.aiCreditPurchase.findFirst({
      where: { externalReference },
      select: { id: true },
    });
    if (byReference) return byReference.id;
  }

  return null;
}

export async function fulfillAiCreditPurchaseFromMercadoPagoPayment(
  payment: MercadoPagoPayment,
): Promise<AiCreditCheckoutStatusResult | null> {
  if (!isAiCreditsMercadoPagoPayment(payment)) return null;

  const purchaseId = await resolveAiCreditPurchaseIdFromMercadoPagoPayment(payment);
  const sessionId = String(payment.id ?? "").trim();
  const paymentStatus = (payment.status ?? "pending").toLowerCase();

  if (paymentStatus !== "approved") {
    if (purchaseId) {
      await prisma.aiCreditPurchase.updateMany({
        where: { id: purchaseId, status: "PENDING" },
        data: { status: paymentStatus === "cancelled" ? "CANCELED" : "FAILED" },
      });
    }
    return {
      purchaseId: purchaseId || "",
      sessionId,
      status: payment.status ?? "pending",
      approved: false,
    };
  }

  if (!purchaseId) return null;

  const result = await fulfillAiCreditPurchase({
    purchaseId,
    paymentReference: sessionId,
    provider: "mercadopago",
  });

  return {
    purchaseId,
    sessionId,
    status: "approved",
    approved: true,
    walletBalance: result.walletBalance,
  };
}

export async function fulfillAiCreditPurchaseFromStripeSession(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (session.metadata?.checkoutMode !== AI_CREDITS_CHECKOUT_MODE) return false;
  if (session.payment_status !== "paid") return false;

  const purchaseId = session.metadata?.purchaseId?.trim();
  if (!purchaseId) return false;

  await fulfillAiCreditPurchase({
    purchaseId,
    paymentReference: session.id,
    provider: "stripe",
  });
  return true;
}

export async function getAiCreditPurchaseCheckoutStatus(
  organizationId: string,
  sessionId: string,
): Promise<AiCreditCheckoutStatusResult> {
  const purchase = await prisma.aiCreditPurchase.findFirst({
    where: {
      organizationId,
      checkoutSessionId: sessionId,
    },
  });
  if (!purchase) {
    throw new AiCreditPurchaseError("AI credit checkout session not found", "checkout_not_found");
  }

  if (purchase.status === "COMPLETED") {
    const wallet = await prisma.organizationAiWallet.findUnique({
      where: { organizationId },
    });
    return {
      purchaseId: purchase.id,
      sessionId,
      status: "completed",
      approved: true,
      walletBalance: moneyToApiString(wallet?.balance ?? money(0)),
    };
  }

  if (purchase.paymentProvider === "mercadopago") {
    const accessToken = await resolveMercadoPagoAccessTokenForBilling(organizationId, null);
    const payment = await getMercadoPagoPayment(accessToken, sessionId);
    const paymentStatus = (payment.status ?? "pending").toLowerCase();

    if (paymentStatus === "approved") {
      const result = await fulfillAiCreditPurchase({
        purchaseId: purchase.id,
        paymentReference: sessionId,
        provider: "mercadopago",
      });
      return {
        purchaseId: purchase.id,
        sessionId,
        status: "completed",
        approved: true,
        walletBalance: result.walletBalance,
      };
    }

    if (paymentStatus === "cancelled" || paymentStatus === "rejected") {
      await prisma.aiCreditPurchase.updateMany({
        where: { id: purchase.id, status: "PENDING" },
        data: { status: paymentStatus === "cancelled" ? "CANCELED" : "FAILED" },
      });
    }

    return {
      purchaseId: purchase.id,
      sessionId,
      status: payment.status ?? "pending",
      approved: false,
    };
  }

  return {
    purchaseId: purchase.id,
    sessionId,
    status: purchase.status.toLowerCase(),
    approved: false,
  };
}

export type SerializedAiCreditPurchase = {
  id: string;
  organizationId: string;
  organizationName?: string | null;
  packageId: string;
  packageName: string;
  packageSlug: string;
  paymentProvider: string;
  status: string;
  checkoutSessionId: string | null;
  creditAmount: string;
  amountCents: number;
  currency: string;
  completedAt: string | null;
  createdAt: string;
};

function serializeAiCreditPurchase(row: {
  id: string;
  organizationId: string;
  organization?: { name: string } | null;
  packageId: string;
  package: { name: string; slug: string };
  paymentProvider: string;
  status: string;
  checkoutSessionId: string | null;
  creditAmount: import("@prisma/client").Prisma.Decimal;
  amountCents: number;
  currency: string;
  completedAt: Date | null;
  createdAt: Date;
}): SerializedAiCreditPurchase {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    packageId: row.packageId,
    packageName: row.package.name,
    packageSlug: row.package.slug,
    paymentProvider: row.paymentProvider,
    status: row.status,
    checkoutSessionId: row.checkoutSessionId,
    creditAmount: moneyToApiString(row.creditAmount),
    amountCents: row.amountCents,
    currency: row.currency,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listOrganizationAiCreditPurchases(organizationId: string, limit = 20) {
  const rows = await prisma.aiCreditPurchase.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      package: { select: { name: true, slug: true } },
    },
  });
  return rows.map(serializeAiCreditPurchase);
}

export async function listAllAiCreditPurchases(input?: {
  organizationId?: string;
  status?: string;
  limit?: number;
}) {
  const rows = await prisma.aiCreditPurchase.findMany({
    where: {
      ...(input?.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input?.status ? { status: input.status as import("@prisma/client").AiCreditPurchaseStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input?.limit ?? 50, 1), 200),
    include: {
      package: { select: { name: true, slug: true } },
      organization: { select: { name: true } },
    },
  });
  return rows.map(serializeAiCreditPurchase);
}
