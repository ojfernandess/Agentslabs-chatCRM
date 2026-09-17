import { randomUUID } from "node:crypto";
import { prisma } from "../../../db.js";
import { config } from "../../../config.js";
import { recordBillingAudit } from "../billingAudit.js";
import { assertCheckoutAllowed } from "../checkoutGuards.js";
import { resolveBillingEmail } from "../billingEmailRecipients.js";
import { BillingError } from "../StripeCustomerService.js";
import {
  mercadoPagoRequest,
  resolveMercadoPagoAccessTokenForBilling,
} from "./mercadoPagoClient.js";
import { createMercadoPagoPixCheckout } from "./MercadoPagoPixPaymentService.js";
import type { CheckoutPixDetails } from "../providers/types.js";

export type MercadoPagoPaymentMethod = "card" | "pix";

export type CreateMercadoPagoCheckoutInput = {
  organizationId: string;
  planId: string;
  actorUserId: string;
  ip?: string | null;
  paymentMethod?: MercadoPagoPaymentMethod;
  payerIdentificationNumber?: string | null;
};

export type CreateMercadoPagoCheckoutResult = {
  url: string;
  sessionId: string;
  mode?: "redirect" | "pix";
  pix?: CheckoutPixDetails;
};

type MercadoPagoPreapproval = {
  id: string;
  init_point?: string;
  status?: string;
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

export async function createMercadoPagoCheckoutSession(
  input: CreateMercadoPagoCheckoutInput,
): Promise<CreateMercadoPagoCheckoutResult> {
  const plan = await prisma.plan.findFirst({
    where: { id: input.planId, isActive: true },
  });
  if (!plan) throw new BillingError("Plan not found or inactive", "plan_not_found");
  if (!plan.mercadopagoPlanId?.trim() && input.paymentMethod !== "pix") {
    throw new BillingError("Plan is not linked to a Mercado Pago preapproval plan", "plan_not_mercadopago_ready");
  }
  if (plan.amountCents <= 0) {
    throw new BillingError("Free plans cannot use Mercado Pago Checkout", "free_plan_checkout");
  }

  await assertCheckoutAllowed(input.organizationId, plan.id);

  if (input.paymentMethod === "pix") {
    return createMercadoPagoPixCheckout(input, plan);
  }

  const accessToken = await resolveAccessTokenForCheckout(input.organizationId, plan.organizationId);
  const payerEmail = await resolvePayerEmail(input.organizationId);
  const checkoutAttemptId = randomUUID();
  const externalReference = `ONX-${input.organizationId}-${checkoutAttemptId}`;

  const preapproval = await mercadoPagoRequest<MercadoPagoPreapproval>({
    accessToken,
    method: "POST",
    path: "/preapproval",
    body: {
      preapproval_plan_id: plan.mercadopagoPlanId,
      reason: plan.name.trim(),
      external_reference: externalReference,
      payer_email: payerEmail,
      back_url: config.mercadopagoCheckoutSuccessUrl,
    },
    idempotencyKey: `checkout:${input.organizationId}:${plan.id}`,
  });

  const checkoutUrl = preapproval.init_point?.trim();
  if (!checkoutUrl || !preapproval.id?.trim()) {
    throw new BillingError("Mercado Pago did not return a checkout URL", "checkout_no_url");
  }

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      planId: plan.id,
      paymentProvider: "mercadopago",
      externalPriceId: plan.mercadopagoPlanId,
      status: "incomplete",
      checkoutSessionId: preapproval.id,
      externalSubscriptionId: preapproval.id,
    },
    update: {
      planId: plan.id,
      paymentProvider: "mercadopago",
      externalPriceId: plan.mercadopagoPlanId,
      status: "incomplete",
      checkoutSessionId: preapproval.id,
      externalSubscriptionId: preapproval.id,
    },
  });

  await recordBillingAudit({
    action: "billing.checkout_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: preapproval.id,
    metadata: {
      planId: plan.id,
      planSlug: plan.slug,
      provider: "mercadopago",
      paymentMethod: "card",
      externalReference,
    },
    ip: input.ip,
  });

  return { url: checkoutUrl, sessionId: preapproval.id, mode: "redirect" };
}
