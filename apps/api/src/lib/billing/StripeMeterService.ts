import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { isStripeBillingConfigured } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import { getStripeClient } from "./stripeClient.js";

export type ReportOverageResult =
  | { reported: true }
  | { reported: false; reason: "stripe_not_configured" | "meter_not_configured" | "no_stripe_customer" | "stripe_error"; message?: string };

async function resolveStripeCustomerId(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true },
  });
  if (org?.stripeCustomerId?.trim()) return org.stripeCustomerId.trim();

  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: { stripeCustomerId: true },
  });
  return sub?.stripeCustomerId?.trim() || null;
}

/**
 * Reporta uso excedente via Stripe Billing Meters API.
 * @see https://docs.stripe.com/api/billing/meter-event/create
 */
export async function reportOverageMeterEvent(input: {
  organizationId: string;
  dimension: string;
  quantity?: number;
  idempotencyKey?: string;
  actorUserId?: string | null;
}): Promise<ReportOverageResult> {
  if (!isStripeBillingConfigured()) {
    return { reported: false, reason: "stripe_not_configured" };
  }

  const settings = await getBillingPlatformSettings();
  const dimConfig = settings.overage[input.dimension];
  const eventName = dimConfig?.stripeMeterEventName?.trim();
  if (settings.limitEnforcementMode !== "overage" || !dimConfig?.enabled || !eventName) {
    return { reported: false, reason: "meter_not_configured" };
  }

  const customerId = await resolveStripeCustomerId(input.organizationId);
  if (!customerId) {
    return { reported: false, reason: "no_stripe_customer" };
  }

  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const identifier =
    input.idempotencyKey?.trim() ||
    `${input.organizationId}:${input.dimension}:${Date.now()}:${randomUUID()}`;

  try {
    const stripe = getStripeClient();
    await stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: {
        stripe_customer_id: customerId,
        value: String(quantity),
      },
      identifier,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reported: false, reason: "stripe_error", message };
  }

  try {
    await recordBillingAudit({
      action: "billing.overage_meter_reported",
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      metadata: {
        dimension: input.dimension,
        quantity,
        eventName,
        identifier,
      },
    });
  } catch {
    // Audit failure must not block overage reporting already accepted by Stripe.
  }

  return { reported: true };
}
