import { prisma } from "../../../db.js";
import { config } from "../../../config.js";
import { recordBillingAudit } from "../billingAudit.js";
import { markPaymentWebhookEventProcessed } from "../paymentWebhookEvents.js";
import {
  syncSubscriptionFromMercadoPago,
  resolveOrganizationIdFromMercadoPagoReference,
  type MercadoPagoPreapprovalSnapshot,
} from "../subscriptionSync.js";
import {
  getMercadoPagoPayment,
  syncMercadoPagoPixPaymentIfApproved,
} from "./MercadoPagoPixPaymentService.js";
import {
  fulfillAiCreditPurchaseFromMercadoPagoPayment,
  isAiCreditsMercadoPagoPayment,
} from "../../ai-billing/AiCreditPurchaseService.js";
import {
  mercadoPagoRequest,
  resolveMercadoPagoAccessTokenForBilling,
} from "./mercadoPagoClient.js";
import { resolvePlatformMercadoPagoAccessToken } from "../mercadoPagoBillingSettings.js";
import { verifyMercadoPagoWebhookSignature } from "./mercadoPagoWebhookSignature.js";

export class MercadoPagoWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MercadoPagoWebhookError";
  }
}

export type MercadoPagoWebhookNotification = {
  id?: number | string;
  type?: string;
  action?: string;
  data?: { id?: string | number };
  live_mode?: boolean;
};

type MercadoPagoPaymentResource = {
  id: number | string;
  status?: string;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
};

const HANDLED_EVENT_TYPES = new Set(["payment", "subscription_preapproval"]);

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveDataIdFromQuery(query: Record<string, string | undefined>): string | undefined {
  return query["data.id"]?.trim() || query["data_id"]?.trim() || undefined;
}

/** Valida assinatura HMAC do webhook Mercado Pago (query data.id + headers). */
export function assertMercadoPagoWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, string | undefined>,
): void {
  const webhookSecret = config.mercadopagoWebhookSecret.trim();
  if (!webhookSecret) {
    throw new MercadoPagoWebhookError("MERCADOPAGO_WEBHOOK_SECRET is not configured", 500);
  }

  const dataId = resolveDataIdFromQuery(query);
  if (!dataId) {
    throw new MercadoPagoWebhookError("Missing data.id query parameter", 400);
  }

  const valid = verifyMercadoPagoWebhookSignature({
    secret: webhookSecret,
    xSignature: headerValue(headers["x-signature"]),
    xRequestId: headerValue(headers["x-request-id"]),
    dataId,
  });
  if (!valid) {
    throw new MercadoPagoWebhookError("Invalid Mercado Pago webhook signature", 401);
  }
}

async function resolveAccessTokenForOrganization(organizationId: string): Promise<string> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: { plan: { select: { organizationId: true } } },
  });
  return resolveMercadoPagoAccessTokenForBilling(organizationId, sub?.plan?.organizationId ?? null);
}

async function findMercadoPagoSubscriptionByResourceId(resourceId: string) {
  return prisma.organizationSubscription.findFirst({
    where: {
      paymentProvider: "mercadopago",
      OR: [{ checkoutSessionId: resourceId }, { externalSubscriptionId: resourceId }],
    },
    select: {
      organizationId: true,
      plan: { select: { organizationId: true } },
    },
  });
}

async function resolveOrganizationIdFromPayment(payment: MercadoPagoPaymentResource): Promise<string | null> {
  const metaOrgId =
    typeof payment.metadata?.organizationId === "string" ? payment.metadata.organizationId.trim() : "";
  if (metaOrgId) return metaOrgId;

  const fromRef = resolveOrganizationIdFromMercadoPagoReference(payment.external_reference);
  if (fromRef) return fromRef;

  const paymentId = String(payment.id);
  const sub = await findMercadoPagoSubscriptionByResourceId(paymentId);
  return sub?.organizationId ?? null;
}

async function handlePaymentWebhook(paymentId: string, action: string): Promise<string | null> {
  const existingSub = await findMercadoPagoSubscriptionByResourceId(paymentId);
  let organizationId = existingSub?.organizationId ?? null;

  let accessToken = organizationId
    ? await resolveAccessTokenForOrganization(organizationId)
    : await resolvePlatformMercadoPagoAccessToken();

  let payment = await getMercadoPagoPayment(accessToken, paymentId);

  if (!organizationId) {
    organizationId = await resolveOrganizationIdFromPayment(payment);
    if (!organizationId) return null;

    const orgToken = await resolveAccessTokenForOrganization(organizationId);
    if (orgToken !== accessToken) {
      payment = await getMercadoPagoPayment(orgToken, paymentId);
    }
  }

  if (isAiCreditsMercadoPagoPayment(payment)) {
    const fulfilled = await fulfillAiCreditPurchaseFromMercadoPagoPayment(payment);
    if (fulfilled?.approved) {
      await recordBillingAudit({
        action: "billing.payment_succeeded",
        organizationId,
        resourceId: paymentId,
        metadata: {
          provider: "mercadopago",
          paymentStatus: fulfilled.status,
          action,
          checkoutMode: "ai_credits",
          purchaseId: fulfilled.purchaseId,
        },
      });
    }
    return organizationId;
  }

  const result = await syncMercadoPagoPixPaymentIfApproved(organizationId, payment);

  if (result.approved) {
    await recordBillingAudit({
      action: "billing.payment_succeeded",
      organizationId,
      resourceId: paymentId,
      metadata: {
        provider: "mercadopago",
        paymentStatus: result.paymentStatus,
        action,
      },
    });
  }

  return organizationId;
}

async function handlePreapprovalWebhook(preapprovalId: string, action: string): Promise<string | null> {
  const existingSub = await findMercadoPagoSubscriptionByResourceId(preapprovalId);
  let organizationIdHint = existingSub?.organizationId ?? null;

  let accessToken = organizationIdHint
    ? await resolveAccessTokenForOrganization(organizationIdHint)
    : await resolvePlatformMercadoPagoAccessToken();

  let preapproval = await mercadoPagoRequest<MercadoPagoPreapprovalSnapshot>({
    accessToken,
    method: "GET",
    path: `/preapproval/${encodeURIComponent(preapprovalId)}`,
  });

  if (!organizationIdHint) {
    const orgFromRef = resolveOrganizationIdFromMercadoPagoReference(preapproval.external_reference);
    if (orgFromRef) {
      organizationIdHint = orgFromRef;
      const orgToken = await resolveAccessTokenForOrganization(orgFromRef);
      if (orgToken !== accessToken) {
        preapproval = await mercadoPagoRequest<MercadoPagoPreapprovalSnapshot>({
          accessToken: orgToken,
          method: "GET",
          path: `/preapproval/${encodeURIComponent(preapprovalId)}`,
        });
      }
    }
  }

  const result = await syncSubscriptionFromMercadoPago(preapproval, organizationIdHint ?? undefined);
  if (!result) return null;

  if (result.status === "active") {
    await recordBillingAudit({
      action: action.includes("created")
        ? "billing.subscription_created"
        : "billing.payment_succeeded",
      organizationId: result.organizationId,
      resourceId: preapprovalId,
      metadata: { provider: "mercadopago", status: result.status, action },
    });
  } else if (result.status === "canceled") {
    await recordBillingAudit({
      action: "billing.subscription_canceled",
      organizationId: result.organizationId,
      resourceId: preapprovalId,
      metadata: { provider: "mercadopago", status: result.status, action },
    });
  }

  return result.organizationId;
}

/**
 * Processa notificação Mercado Pago com idempotência (PaymentWebhookEvent).
 * Retorna false se evento já foi processado.
 */
export async function processMercadoPagoWebhookNotification(
  notification: MercadoPagoWebhookNotification,
  rawPayload?: unknown,
): Promise<boolean> {
  const eventType = notification.type?.trim() || "";
  const action = notification.action?.trim() || eventType;
  const resourceId = notification.data?.id != null ? String(notification.data.id).trim() : "";

  if (!resourceId) return true;

  if (!HANDLED_EVENT_TYPES.has(eventType)) {
    return true;
  }

  const externalEventId =
    notification.id != null
      ? String(notification.id)
      : `mercadopago:${eventType}:${resourceId}:${action}`;

  const isNew = await markPaymentWebhookEventProcessed({
    provider: "mercadopago",
    externalEventId,
    eventType: action || eventType,
    payload: rawPayload ?? notification,
  });
  if (!isNew) return false;

  let organizationId: string | null = null;

  if (eventType === "payment") {
    organizationId = await handlePaymentWebhook(resourceId, action);
  } else if (eventType === "subscription_preapproval") {
    organizationId = await handlePreapprovalWebhook(resourceId, action);
  }

  if (organizationId) {
    await recordBillingAudit({
      action: "billing.webhook_processed",
      organizationId,
      resourceId: externalEventId,
      metadata: { type: eventType, action, resourceId },
    });
  }

  return true;
}
