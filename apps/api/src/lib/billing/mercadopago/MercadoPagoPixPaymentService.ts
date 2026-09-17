import { randomUUID } from "node:crypto";
import type { Plan } from "@prisma/client";
import { getPublicOrigin } from "../../../config.js";
import { prisma } from "../../../db.js";
import { recordBillingAudit } from "../billingAudit.js";
import { mapMercadoPagoPaymentStatus } from "../billingTypes.js";
import { resolveBillingEmail } from "../billingEmailRecipients.js";
import { BillingError } from "../StripeCustomerService.js";
import { syncSubscriptionSnapshot } from "../subscriptionSync.js";
import {
  getMercadoPagoBillingPlatformSettings,
  MERCADOPAGO_SANDBOX_PIX_PAYER_FIRST_NAME,
  resolveMercadoPagoSandboxPayerEmail,
} from "../mercadoPagoBillingSettings.js";
import {
  assertMercadoPagoAccessTokenMatchesBillingMode,
  mercadoPagoRequest,
  resolveMercadoPagoAccessTokenForBilling,
} from "./mercadoPagoClient.js";
import type { CheckoutPixDetails } from "../providers/types.js";
import type { CreateMercadoPagoCheckoutInput } from "./MercadoPagoCheckoutService.js";

type MercadoPagoPayment = {
  id: number | string;
  status?: string;
  status_detail?: string;
  date_of_expiration?: string | null;
  external_reference?: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

export type MercadoPagoPixCheckoutResult = {
  url: string;
  sessionId: string;
  mode: "pix";
  pix: CheckoutPixDetails;
};

export type MercadoPagoCheckoutStatusResult = {
  sessionId: string;
  paymentStatus: string;
  subscriptionStatus: string;
  approved: boolean;
};

async function resolveAccessTokenForCheckout(organizationId: string, planOrganizationId: string | null) {
  return resolveMercadoPagoAccessTokenForBilling(organizationId, planOrganizationId);
}

async function resolvePayerEmail(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { billingEmail: true },
  });
  const email = org?.billingEmail?.trim() || (await resolveBillingEmail(organizationId));
  if (!email) {
    throw new BillingError(
      "Billing email is required before Mercado Pago checkout",
      "billing_email_missing",
    );
  }
  return email;
}

function mercadoPagoPixNotificationUrl(): string {
  return `${getPublicOrigin()}/webhooks/mercadopago`;
}

function normalizeBrazilTaxId(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function buildMercadoPagoPixPayer(
  email: string,
  identificationNumber?: string | null,
  options?: { firstName?: string; lastName?: string },
) {
  const digits = normalizeBrazilTaxId(identificationNumber);
  if (digits.length !== 11 && digits.length !== 14) {
    throw new BillingError(
      "CPF or CNPJ is required for Mercado Pago Pix payments",
      "mercadopago_pix_document_required",
    );
  }

  const localPart = email.split("@")[0]?.trim() || "Cliente";
  return {
    email,
    first_name: (options?.firstName ?? localPart).slice(0, 50),
    last_name: (options?.lastName ?? "OpenConduit").slice(0, 50),
    identification: {
      type: digits.length === 11 ? "CPF" : "CNPJ",
      number: digits,
    },
  };
}

function pixExpirationIso(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
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

export async function createMercadoPagoPixCheckout(
  input: CreateMercadoPagoCheckoutInput,
  plan: Plan,
): Promise<MercadoPagoPixCheckoutResult> {
  const billingSettings = await getMercadoPagoBillingPlatformSettings();
  const accessToken = await resolveAccessTokenForCheckout(input.organizationId, plan.organizationId);
  await assertMercadoPagoAccessTokenMatchesBillingMode(accessToken, billingSettings.mode);

  let payerEmail = await resolvePayerEmail(input.organizationId);
  const sandboxMode = billingSettings.mode === "sandbox";
  if (sandboxMode) {
    payerEmail = resolveMercadoPagoSandboxPayerEmail(payerEmail);
  }
  const payer = buildMercadoPagoPixPayer(payerEmail, input.payerIdentificationNumber, sandboxMode
    ? { firstName: MERCADOPAGO_SANDBOX_PIX_PAYER_FIRST_NAME, lastName: "Test" }
    : undefined);
  const checkoutAttemptId = randomUUID();
  const externalReference = `ONX-${input.organizationId}-${checkoutAttemptId}`;

  const payment = await mercadoPagoRequest<MercadoPagoPayment>({
    accessToken,
    method: "POST",
    path: "/v1/payments",
    billingMode: billingSettings.mode,
    body: {
      transaction_amount: Number((plan.amountCents / 100).toFixed(2)),
      description: plan.name.trim(),
      payment_method_id: "pix",
      payer,
      external_reference: externalReference,
      notification_url: mercadoPagoPixNotificationUrl(),
      date_of_expiration: pixExpirationIso(),
      metadata: {
        organizationId: input.organizationId,
        planId: plan.id,
        planSlug: plan.slug,
        checkoutMode: "pix",
      },
    },
    idempotencyKey: `pix-checkout:${input.organizationId}:${plan.id}:${checkoutAttemptId}`,
  });

  const sessionId = String(payment.id ?? "").trim();
  if (!sessionId) {
    throw new BillingError("Mercado Pago did not return a payment id", "mercadopago_pix_checkout_failed");
  }

  const pix = extractPixDetails(payment);
  const subscriptionStatus = mapMercadoPagoPaymentStatus(payment.status ?? "pending");

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      planId: plan.id,
      paymentProvider: "mercadopago",
      externalPriceId: plan.mercadopagoPlanId,
      status: subscriptionStatus,
      checkoutSessionId: sessionId,
      externalSubscriptionId: sessionId,
    },
    update: {
      planId: plan.id,
      paymentProvider: "mercadopago",
      externalPriceId: plan.mercadopagoPlanId,
      status: subscriptionStatus,
      checkoutSessionId: sessionId,
      externalSubscriptionId: sessionId,
    },
  });

  await recordBillingAudit({
    action: "billing.checkout_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: sessionId,
    metadata: {
      planId: plan.id,
      planSlug: plan.slug,
      provider: "mercadopago",
      paymentMethod: "pix",
      externalReference,
    },
    ip: input.ip,
  });

  return {
    url: pix.ticketUrl ?? "",
    sessionId,
    mode: "pix",
    pix,
  };
}

export async function getMercadoPagoPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  return mercadoPagoRequest<MercadoPagoPayment>({
    accessToken,
    method: "GET",
    path: `/v1/payments/${encodeURIComponent(paymentId)}`,
  });
}

export async function syncMercadoPagoPixPaymentIfApproved(
  organizationId: string,
  payment: MercadoPagoPayment,
): Promise<MercadoPagoCheckoutStatusResult> {
  const paymentStatus = payment.status ?? "pending";
  const subscriptionStatus = mapMercadoPagoPaymentStatus(paymentStatus);
  const approved = subscriptionStatus === "active";

  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      planId: true,
      plan: { select: { mercadopagoPlanId: true } },
    },
  });

  if (approved) {
    await syncSubscriptionSnapshot({
      organizationId,
      planId: sub?.planId ?? null,
      paymentProvider: "mercadopago",
      status: "active",
      externalSubscriptionId: String(payment.id),
      externalPriceId: sub?.plan?.mercadopagoPlanId ?? null,
      checkoutSessionId: String(payment.id),
      clearPaymentDue: true,
    });
  } else {
    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: { status: subscriptionStatus },
    });
  }

  return {
    sessionId: String(payment.id),
    paymentStatus,
    subscriptionStatus: approved ? "active" : subscriptionStatus,
    approved,
  };
}

export async function getMercadoPagoCheckoutStatus(
  organizationId: string,
  sessionId: string,
): Promise<MercadoPagoCheckoutStatusResult> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      checkoutSessionId: true,
      paymentProvider: true,
      plan: { select: { organizationId: true } },
    },
  });

  if (!sub || sub.paymentProvider !== "mercadopago") {
    throw new BillingError("Checkout session not found", "checkout_not_found");
  }
  if (sub.checkoutSessionId !== sessionId) {
    throw new BillingError("Checkout session not found", "checkout_not_found");
  }

  const accessToken = await resolveAccessTokenForCheckout(organizationId, sub.plan?.organizationId ?? null);
  const payment = await getMercadoPagoPayment(accessToken, sessionId);
  return syncMercadoPagoPixPaymentIfApproved(organizationId, payment);
}
