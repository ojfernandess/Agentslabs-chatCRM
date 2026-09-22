import type { Prisma } from "@prisma/client";
import { mercadoPagoToolWebhookUrlForOrganization } from "../config.js";
import { prisma } from "../db.js";
import { mergeFlowSlotsAutomationContext } from "./automationConversationContextLib.js";
import type { MercadoPagoWebhookNotification } from "./billing/mercadopago/mercadoPagoWebhookHandler.js";
import { verifyMercadoPagoWebhookSignature } from "./billing/mercadopago/mercadoPagoWebhookSignature.js";
import { mercadoPagoRequest } from "./billing/mercadopago/mercadoPagoClient.js";
import {
  isMercadoPagoAutomationTool,
  isOrganizationAgentMercadoPagoMetadata,
  readMercadoPagoToolConfig,
  type MercadoPagoToolConfig,
} from "./mercadoPagoToolExecute.js";

export const ORG_MERCADO_PAGO_WEBHOOK_EVENT_TYPES = ["payment"] as const;

export const ORG_MERCADO_PAGO_WEBHOOK_ADDITIONAL_EVENT_TYPES = [
  "subscription_preapproval",
  "merchant_order",
  "subscription_authorized_payment",
] as const;

export class OrganizationMercadoPagoWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "OrganizationMercadoPagoWebhookError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asJson(v: unknown): object {
  return v as object;
}

function asMetadataRecord(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return metadata && typeof metadata === "object" ? metadata : {};
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveDataIdFromQuery(query: Record<string, string | undefined>): string | undefined {
  return query["data.id"]?.trim() || query["data_id"]?.trim() || undefined;
}

export function assertOrganizationMercadoPagoWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, string | undefined>,
  webhookSecret: string,
): void {
  const secret = webhookSecret.trim();
  if (!secret) {
    throw new OrganizationMercadoPagoWebhookError("Webhook secret is not configured on this tool", 400);
  }
  const dataId = resolveDataIdFromQuery(query);
  if (!dataId) {
    throw new OrganizationMercadoPagoWebhookError("Missing data.id query parameter", 400);
  }
  const valid = verifyMercadoPagoWebhookSignature({
    secret,
    xSignature: headerValue(headers["x-signature"]),
    xRequestId: headerValue(headers["x-request-id"]),
    dataId,
  });
  if (!valid) {
    throw new OrganizationMercadoPagoWebhookError("Invalid Mercado Pago webhook signature", 401);
  }
}

async function markOrganizationMercadoPagoEventProcessed(input: {
  organizationId: string;
  toolId: string;
  externalEventId: string;
  type: string;
  payload: unknown;
}): Promise<boolean> {
  const id = `${input.toolId}:${input.externalEventId}`;
  try {
    await prisma.automationMercadoPagoWebhookEvent.create({
      data: {
        id,
        organizationId: input.organizationId,
        toolId: input.toolId,
        externalEventId: input.externalEventId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return false;
    throw err;
  }
}

async function persistMercadoPagoToolWebhookExecution(input: {
  organizationId: string;
  toolId: string;
  ok: boolean;
  eventType: string;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  errorMessage: string | null;
}): Promise<void> {
  await prisma.automationToolExecution.create({
    data: {
      organizationId: input.organizationId,
      toolId: input.toolId,
      source: "mp_webhook",
      ok: input.ok,
      statusCode: input.ok ? 200 : null,
      durationMs: 0,
      requestSummary: asJson(input.requestSummary),
      responseSummary: asJson(input.responseSummary),
      errorMessage: input.errorMessage,
      tokensUsed: null,
      botId: null,
    },
  });
}

async function applyPaidPaymentToConversation(input: {
  organizationId: string;
  toolId: string;
  conversationId: string;
  paymentStatus: string;
  summary: Record<string, unknown>;
}): Promise<{ applied: boolean; reason?: string }> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, botId: true },
  });
  if (!conversation?.botId) {
    return { applied: false, reason: "conversation_not_found_or_no_bot" };
  }

  await mergeFlowSlotsAutomationContext({
    organizationId: input.organizationId,
    conversationId: conversation.id,
    botId: conversation.botId,
    flowSlots: {
      paymentStatus: input.paymentStatus,
      mercadoPagoToolId: input.toolId,
      ...input.summary,
    },
  });
  return { applied: true };
}

function resolveConversationIdFromPayment(payment: Record<string, unknown>): string {
  const meta = asMetadataRecord(payment.metadata as Record<string, unknown> | null | undefined);
  return str(meta.conversationId);
}

async function handlePaymentNotification(input: {
  organizationId: string;
  toolId: string;
  cfg: MercadoPagoToolConfig;
  paymentId: string;
}): Promise<Record<string, unknown>> {
  const payment = await mercadoPagoRequest<Record<string, unknown>>({
    accessToken: input.cfg.accessToken,
    method: "GET",
    path: `/v1/payments/${encodeURIComponent(input.paymentId)}`,
  });

  const meta = asMetadataRecord(payment.metadata as Record<string, unknown> | null | undefined);
  if (str(meta.organizationId) && str(meta.organizationId) !== input.organizationId) {
    return { ignored: true, reason: "organization_mismatch" };
  }
  if (str(meta.toolId) && str(meta.toolId) !== input.toolId) {
    return { ignored: true, reason: "tool_mismatch" };
  }
  if (!isOrganizationAgentMercadoPagoMetadata(meta)) {
    return { ignored: true, reason: "not_agent_tool_payment" };
  }

  const status = str(payment.status).toLowerCase();
  if (status !== "approved") {
    return { ignored: true, reason: "payment_not_approved", status };
  }

  const conversationId = resolveConversationIdFromPayment(payment);
  const summary: Record<string, unknown> = {
    mercadoPagoPaymentId: payment.id,
    totalAmount: payment.transaction_amount,
    currency: payment.currency_id,
    mercadoPagoPaidAt: payment.date_approved ?? new Date().toISOString(),
  };

  if (!conversationId) {
    return { paid: true, conversationLinked: false, ...summary };
  }

  const linked = await applyPaidPaymentToConversation({
    organizationId: input.organizationId,
    toolId: input.toolId,
    conversationId,
    paymentStatus: "paid",
    summary,
  });
  return {
    paid: true,
    conversationLinked: linked.applied,
    conversationId,
    ...summary,
    ...(linked.reason ? { linkReason: linked.reason } : {}),
  };
}

export async function loadOrganizationMercadoPagoToolForWebhook(input: {
  organizationId: string;
  toolId: string;
}): Promise<{
  id: string;
  organizationId: string;
  name: string;
  toolType: string;
  config: unknown;
  isActive: boolean;
  cfg: MercadoPagoToolConfig;
} | null> {
  const tool = await prisma.automationCustomTool.findFirst({
    where: { id: input.toolId, organizationId: input.organizationId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      toolType: true,
      config: true,
      isActive: true,
    },
  });
  if (!tool || !isMercadoPagoAutomationTool(tool)) return null;
  return { ...tool, cfg: readMercadoPagoToolConfig(tool.config) };
}

export async function processOrganizationMercadoPagoToolWebhook(input: {
  organizationId: string;
  toolId: string;
  notification: MercadoPagoWebhookNotification;
  rawPayload?: unknown;
}): Promise<{ duplicate: boolean; result: Record<string, unknown> }> {
  const tool = await loadOrganizationMercadoPagoToolForWebhook(input);
  if (!tool) {
    throw new OrganizationMercadoPagoWebhookError("Mercado Pago tool not found", 404);
  }
  if (!tool.isActive) {
    throw new OrganizationMercadoPagoWebhookError("Mercado Pago tool is inactive", 400);
  }

  const eventType = input.notification.type?.trim() || "";
  const action = input.notification.action?.trim() || eventType;
  const resourceId = input.notification.data?.id != null ? String(input.notification.data.id).trim() : "";

  if (!resourceId) {
    return { duplicate: false, result: { ignored: true, reason: "missing_resource_id" } };
  }

  const handled = new Set<string>([
    ...ORG_MERCADO_PAGO_WEBHOOK_EVENT_TYPES,
    ...ORG_MERCADO_PAGO_WEBHOOK_ADDITIONAL_EVENT_TYPES,
  ]);
  if (!handled.has(eventType)) {
    return { duplicate: false, result: { ignored: true, reason: "unsupported_event_type", type: eventType } };
  }

  const externalEventId =
    input.notification.id != null
      ? String(input.notification.id)
      : `mercadopago:${eventType}:${resourceId}:${action}`;

  const isNew = await markOrganizationMercadoPagoEventProcessed({
    organizationId: input.organizationId,
    toolId: input.toolId,
    externalEventId,
    type: action || eventType,
    payload: input.rawPayload ?? input.notification,
  });
  if (!isNew) {
    return { duplicate: true, result: { duplicate: true, type: eventType } };
  }

  let result: Record<string, unknown> = { type: eventType, action };
  try {
    if (eventType === "payment") {
      result = {
        ...(await handlePaymentNotification({
          organizationId: input.organizationId,
          toolId: input.toolId,
          cfg: tool.cfg,
          paymentId: resourceId,
        })),
        type: eventType,
        action,
      };
    } else {
      result = { ignored: true, reason: "event_not_processed_yet", type: eventType, action };
    }

    await persistMercadoPagoToolWebhookExecution({
      organizationId: input.organizationId,
      toolId: input.toolId,
      ok: !result.ignored,
      eventType: action || eventType,
      requestSummary: { externalEventId, type: eventType, resourceId },
      responseSummary: { result },
      errorMessage: result.ignored ? String(result.reason ?? "ignored") : null,
    });

    return { duplicate: false, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistMercadoPagoToolWebhookExecution({
      organizationId: input.organizationId,
      toolId: input.toolId,
      ok: false,
      eventType: action || eventType,
      requestSummary: { externalEventId, type: eventType },
      responseSummary: { error: message.slice(0, 500) },
      errorMessage: "mercadopago_tool_webhook_failed",
    });
    throw err;
  }
}

export function organizationMercadoPagoWebhookSetup(input: {
  organizationId: string;
  toolId: string;
  webhookSecretConfigured: boolean;
}): {
  webhookUrl: string;
  recommendedEvents: readonly string[];
  additionalEvents: readonly string[];
  webhookSecretConfigured: boolean;
} {
  return {
    webhookUrl: mercadoPagoToolWebhookUrlForOrganization(input.organizationId, input.toolId),
    recommendedEvents: ORG_MERCADO_PAGO_WEBHOOK_EVENT_TYPES,
    additionalEvents: ORG_MERCADO_PAGO_WEBHOOK_ADDITIONAL_EVENT_TYPES,
    webhookSecretConfigured: input.webhookSecretConfigured,
  };
}
