import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "../../db.js";
import { isStripeBillingConfigured } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import type { BillingPlatformSettings } from "./billingTypes.js";
import { getStripeClient } from "./stripeClient.js";

export type ReportOverageResult =
  | { reported: true }
  | { reported: false; reason: "stripe_not_configured" | "meter_not_configured" | "no_stripe_customer" | "stripe_error"; message?: string };

export type SyncOverageMeterAction = "existing" | "created" | "reactivated";

export type SyncOverageMetersResult = {
  synced: Array<{ dimension: string; eventName: string; action: SyncOverageMeterAction }>;
  errors: Array<{ dimension: string; eventName: string; message: string }>;
};

const ensuredMeterEventNames = new Set<string>();

function meterDisplayName(dimension: string, eventName: string): string {
  const label = dimension.trim() || eventName;
  return `OpenConduit ${label} overage`;
}

function isNoActiveMeterError(message: string): boolean {
  return /no active meter found/i.test(message);
}

async function listAllBillingMeters(stripe: Stripe): Promise<Stripe.Billing.Meter[]> {
  const meters: Stripe.Billing.Meter[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.billing.meters.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    meters.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }

  return meters;
}

async function findBillingMeterByEventName(
  stripe: Stripe,
  eventName: string,
): Promise<Stripe.Billing.Meter | null> {
  const meters = await listAllBillingMeters(stripe);
  return meters.find((meter) => meter.event_name === eventName) ?? null;
}

/** Garante um Billing Meter ativo no Stripe para o event_name configurado. */
export async function ensureStripeOverageMeter(input: {
  eventName: string;
  dimension: string;
}): Promise<{ ok: true; action: SyncOverageMeterAction } | { ok: false; message: string }> {
  const eventName = input.eventName.trim();
  if (!eventName) {
    return { ok: false, message: "Missing meter event name" };
  }

  if (ensuredMeterEventNames.has(eventName)) {
    return { ok: true, action: "existing" };
  }

  try {
    const stripe = getStripeClient();
    const existing = await findBillingMeterByEventName(stripe, eventName);

    if (existing?.status === "active") {
      ensuredMeterEventNames.add(eventName);
      return { ok: true, action: "existing" };
    }

    if (existing?.status === "inactive") {
      await stripe.billing.meters.reactivate(existing.id);
      ensuredMeterEventNames.add(eventName);
      return { ok: true, action: "reactivated" };
    }

    await stripe.billing.meters.create({
      display_name: meterDisplayName(input.dimension, eventName),
      event_name: eventName,
      default_aggregation: { formula: "sum" },
      customer_mapping: {
        type: "by_id",
        event_payload_key: "stripe_customer_id",
      },
      value_settings: {
        event_payload_key: "value",
      },
    });

    ensuredMeterEventNames.add(eventName);
    return { ok: true, action: "created" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

/** Sincroniza medidores Stripe para dimensões de overage habilitadas na política de billing. */
export async function syncBillingOverageMeters(
  settings: BillingPlatformSettings,
): Promise<SyncOverageMetersResult> {
  const result: SyncOverageMetersResult = { synced: [], errors: [] };

  if (!isStripeBillingConfigured() || settings.limitEnforcementMode !== "overage") {
    return result;
  }

  for (const [dimension, dimConfig] of Object.entries(settings.overage)) {
    const eventName = dimConfig?.stripeMeterEventName?.trim();
    if (!dimConfig?.enabled || !eventName) continue;

    ensuredMeterEventNames.delete(eventName);
    const ensured = await ensureStripeOverageMeter({ eventName, dimension });
    if (ensured.ok) {
      result.synced.push({ dimension, eventName, action: ensured.action });
    } else {
      result.errors.push({ dimension, eventName, message: ensured.message });
    }
  }

  return result;
}

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

async function createMeterEvent(input: {
  eventName: string;
  customerId: string;
  quantity: number;
  identifier: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const stripe = getStripeClient();
    await stripe.billing.meterEvents.create({
      event_name: input.eventName,
      payload: {
        stripe_customer_id: input.customerId,
        value: String(input.quantity),
      },
      identifier: input.identifier,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
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

  const ensured = await ensureStripeOverageMeter({ eventName, dimension: input.dimension });
  if (!ensured.ok) {
    return { reported: false, reason: "stripe_error", message: ensured.message };
  }

  let created = await createMeterEvent({ eventName, customerId, quantity, identifier });
  if (!created.ok && isNoActiveMeterError(created.message)) {
    ensuredMeterEventNames.delete(eventName);
    const retryEnsure = await ensureStripeOverageMeter({ eventName, dimension: input.dimension });
    if (retryEnsure.ok) {
      created = await createMeterEvent({ eventName, customerId, quantity, identifier });
    }
  }

  if (!created.ok) {
    return { reported: false, reason: "stripe_error", message: created.message };
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

/** Reseta cache de medidores garantidos (testes). */
export function resetEnsuredBillingMetersForTests(): void {
  ensuredMeterEventNames.clear();
}
