import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { stripeToolWebhookUrlForOrganization } from "../config.js";
import { prisma } from "../db.js";
import { mergeFlowSlotsAutomationContext } from "./automationConversationContextLib.js";
import {
  isOrganizationAgentStripeMetadata,
  isStripeAutomationTool,
  readStripeToolConfig,
  type StripeToolConfig,
} from "./stripeToolExecute.js";

export const ORG_STRIPE_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
] as const;

/** Opcionais — monitorização; nem todos alteram flowSlots hoje. */
export const ORG_STRIPE_WEBHOOK_ADDITIONAL_EVENT_TYPES = [
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export class OrganizationStripeWebhookError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "OrganizationStripeWebhookError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asJson(v: unknown): object {
  return v as object;
}

function stripeMetadataRecord(metadata: Stripe.Metadata | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function constructOrganizationStripeWebhookEvent(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  webhookSecret: string,
): Stripe.Event {
  const secret = webhookSecret.trim();
  if (!secret) {
    throw new OrganizationStripeWebhookError("Stripe webhook secret is not configured on this tool", 400);
  }
  if (!signatureHeader?.trim()) {
    throw new OrganizationStripeWebhookError("Missing Stripe-Signature header", 400);
  }
  try {
    return Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid webhook signature";
    throw new OrganizationStripeWebhookError(msg, 400);
  }
}

async function markOrganizationStripeEventProcessed(input: {
  organizationId: string;
  toolId: string;
  event: Stripe.Event;
}): Promise<boolean> {
  const id = `${input.toolId}:${input.event.id}`;
  try {
    await prisma.automationStripeWebhookEvent.create({
      data: {
        id,
        organizationId: input.organizationId,
        toolId: input.toolId,
        stripeEventId: input.event.id,
        type: input.event.type,
        payload: input.event as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return false;
    throw err;
  }
}

function resolveConversationIdFromSession(session: Stripe.Checkout.Session): string {
  const meta = session.metadata ?? {};
  return str(meta.conversationId) || str(session.client_reference_id);
}

function resolvePaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null | undefined,
): string | null {
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id ?? null;
}

async function persistStripeToolWebhookExecution(input: {
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
      source: "stripe_webhook",
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
      stripeToolId: input.toolId,
      ...input.summary,
    },
  });
  return { applied: true };
}

async function handleCheckoutSessionEvent(input: {
  organizationId: string;
  toolId: string;
  session: Stripe.Checkout.Session;
  eventType: string;
}): Promise<Record<string, unknown>> {
  const meta = input.session.metadata ?? {};
  if (str(meta.organizationId) && str(meta.organizationId) !== input.organizationId) {
    return { ignored: true, reason: "organization_mismatch" };
  }
  if (str(meta.toolId) && str(meta.toolId) !== input.toolId) {
    return { ignored: true, reason: "tool_mismatch" };
  }
  if (!isOrganizationAgentStripeMetadata(stripeMetadataRecord(meta)) && !str(input.session.client_reference_id)) {
    return { ignored: true, reason: "not_agent_tool_checkout" };
  }

  const paid =
    input.session.payment_status === "paid" ||
    input.session.status === "complete" ||
    input.eventType === "checkout.session.async_payment_succeeded";
  if (!paid) {
    return { ignored: true, reason: "session_not_paid", paymentStatus: input.session.payment_status ?? null };
  }

  const conversationId = resolveConversationIdFromSession(input.session);
  const summary: Record<string, unknown> = {
    stripeCheckoutSessionId: input.session.id,
    stripePaymentIntentId: resolvePaymentIntentId(input.session.payment_intent),
    totalAmount: input.session.amount_total,
    currency: input.session.currency,
    stripePaidAt: new Date().toISOString(),
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
  return { paid: true, conversationLinked: linked.applied, conversationId, ...summary, ...(linked.reason ? { linkReason: linked.reason } : {}) };
}

async function handlePaymentIntentSucceeded(input: {
  organizationId: string;
  toolId: string;
  paymentIntent: Stripe.PaymentIntent;
}): Promise<Record<string, unknown>> {
  const meta = input.paymentIntent.metadata ?? {};
  if (str(meta.organizationId) && str(meta.organizationId) !== input.organizationId) {
    return { ignored: true, reason: "organization_mismatch" };
  }
  if (str(meta.toolId) && str(meta.toolId) !== input.toolId) {
    return { ignored: true, reason: "tool_mismatch" };
  }
  if (!isOrganizationAgentStripeMetadata(stripeMetadataRecord(meta))) {
    return { ignored: true, reason: "not_agent_tool_payment" };
  }

  const conversationId = str(meta.conversationId);
  const summary: Record<string, unknown> = {
    stripePaymentIntentId: input.paymentIntent.id,
    totalAmount: input.paymentIntent.amount_received ?? input.paymentIntent.amount,
    currency: input.paymentIntent.currency,
    stripePaidAt: new Date().toISOString(),
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
  return { paid: true, conversationLinked: linked.applied, conversationId, ...summary, ...(linked.reason ? { linkReason: linked.reason } : {}) };
}

export async function loadOrganizationStripeToolForWebhook(input: {
  organizationId: string;
  toolId: string;
}): Promise<{
  id: string;
  organizationId: string;
  name: string;
  toolType: string;
  config: unknown;
  isActive: boolean;
  cfg: StripeToolConfig;
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
  if (!tool || !isStripeAutomationTool(tool)) return null;
  return { ...tool, cfg: readStripeToolConfig(tool.config) };
}

/**
 * Processa webhook Stripe de ferramenta de automação (conta Stripe da organização).
 * Distinto de `/webhooks/stripe` (billing SaaS da plataforma).
 */
export async function processOrganizationStripeToolWebhook(input: {
  organizationId: string;
  toolId: string;
  event: Stripe.Event;
}): Promise<{ duplicate: boolean; result: Record<string, unknown> }> {
  const tool = await loadOrganizationStripeToolForWebhook(input);
  if (!tool) {
    throw new OrganizationStripeWebhookError("Stripe tool not found", 404);
  }
  if (!tool.isActive) {
    throw new OrganizationStripeWebhookError("Stripe tool is inactive", 400);
  }

  const handledTypes = new Set<string>(ORG_STRIPE_WEBHOOK_EVENT_TYPES);
  if (!handledTypes.has(input.event.type)) {
    return { duplicate: false, result: { ignored: true, reason: "unsupported_event_type", type: input.event.type } };
  }

  const isNew = await markOrganizationStripeEventProcessed({
    organizationId: input.organizationId,
    toolId: input.toolId,
    event: input.event,
  });
  if (!isNew) {
    return { duplicate: true, result: { duplicate: true, type: input.event.type } };
  }

  let result: Record<string, unknown> = { type: input.event.type };
  try {
    if (
      input.event.type === "checkout.session.completed" ||
      input.event.type === "checkout.session.async_payment_succeeded"
    ) {
      result = {
        ...(await handleCheckoutSessionEvent({
          organizationId: input.organizationId,
          toolId: input.toolId,
          session: input.event.data.object as Stripe.Checkout.Session,
          eventType: input.event.type,
        })),
        type: input.event.type,
      };
    } else if (input.event.type === "payment_intent.succeeded") {
      result = {
        ...(await handlePaymentIntentSucceeded({
          organizationId: input.organizationId,
          toolId: input.toolId,
          paymentIntent: input.event.data.object as Stripe.PaymentIntent,
        })),
        type: input.event.type,
      };
    }

    await persistStripeToolWebhookExecution({
      organizationId: input.organizationId,
      toolId: input.toolId,
      ok: !result.ignored,
      eventType: input.event.type,
      requestSummary: { stripeEventId: input.event.id, type: input.event.type },
      responseSummary: { result },
      errorMessage: result.ignored ? String(result.reason ?? "ignored") : null,
    });

    return { duplicate: false, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistStripeToolWebhookExecution({
      organizationId: input.organizationId,
      toolId: input.toolId,
      ok: false,
      eventType: input.event.type,
      requestSummary: { stripeEventId: input.event.id, type: input.event.type },
      responseSummary: { error: message.slice(0, 500) },
      errorMessage: "stripe_tool_webhook_failed",
    });
    throw err;
  }
}

export function organizationStripeWebhookSetup(input: {
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
    webhookUrl: stripeToolWebhookUrlForOrganization(input.organizationId, input.toolId),
    recommendedEvents: ORG_STRIPE_WEBHOOK_EVENT_TYPES,
    additionalEvents: ORG_STRIPE_WEBHOOK_ADDITIONAL_EVENT_TYPES,
    webhookSecretConfigured: input.webhookSecretConfigured,
  };
}
