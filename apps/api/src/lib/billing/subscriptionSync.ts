import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  mapStripeSubscriptionStatus,
  mapMercadoPagoPreapprovalStatus,
  type PaymentProviderName,
  type SubscriptionStatus,
} from "./billingTypes.js";
import { getSubscriptionBillingPeriod } from "./stripeHelpers.js";
import { resolvePlanIdFromMercadoPagoPlanId } from "./mercadopago/MercadoPagoPlanService.js";

function stripeUnixToDate(value: number | null | undefined): Date | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

async function resolvePlanIdFromStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metaPlanId = subscription.metadata?.planId?.trim();
  if (metaPlanId) {
    const byId = await prisma.plan.findUnique({ where: { id: metaPlanId }, select: { id: true } });
    if (byId) return byId.id;
  }

  const priceId = subscription.items.data[0]?.price?.id?.trim();
  if (priceId) {
    const byPrice = await prisma.plan.findFirst({
      where: { stripePriceId: priceId },
      select: { id: true },
    });
    if (byPrice) return byPrice.id;
  }

  return null;
}

export type SyncSubscriptionResult = {
  organizationId: string;
  planId: string | null;
  status: string;
};

export type SubscriptionSnapshotInput = {
  organizationId: string;
  planId: string | null;
  paymentProvider: PaymentProviderName;
  status: SubscriptionStatus;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  externalPriceId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  checkoutSessionId?: string | null;
  clearPaymentDue?: boolean;
};

/**
 * Persiste snapshot provider-agnostic → OrganizationSubscription + plan_tier legado.
 */
export async function syncSubscriptionSnapshot(
  input: SubscriptionSnapshotInput,
): Promise<SyncSubscriptionResult> {
  const subData: Prisma.OrganizationSubscriptionUncheckedUpdateInput = {
    organizationId: input.organizationId,
    planId: input.planId,
    paymentProvider: input.paymentProvider,
    externalCustomerId: input.externalCustomerId ?? undefined,
    externalSubscriptionId: input.externalSubscriptionId ?? undefined,
    externalPriceId: input.externalPriceId ?? undefined,
    stripeCustomerId: input.stripeCustomerId ?? undefined,
    stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
    stripePriceId: input.stripePriceId ?? undefined,
    status: input.status,
    currentPeriodStart: input.currentPeriodStart ?? undefined,
    currentPeriodEnd: input.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    canceledAt: input.canceledAt ?? undefined,
    trialStart: input.trialStart ?? undefined,
    trialEnd: input.trialEnd ?? undefined,
    checkoutSessionId: input.checkoutSessionId ?? undefined,
    ...(input.clearPaymentDue ? { paymentDueAt: null } : {}),
  };

  await prisma.organizationSubscription.upsert({
    where: { organizationId: input.organizationId },
    create: subData as Prisma.OrganizationSubscriptionUncheckedCreateInput,
    update: subData,
  });

  const customerId = input.externalCustomerId ?? input.stripeCustomerId;
  if (customerId) {
    const orgUpdate: Prisma.OrganizationUpdateInput = {};
    if (input.paymentProvider === "stripe") {
      orgUpdate.stripeCustomerId = customerId;
    }
    if (Object.keys(orgUpdate).length > 0) {
      await prisma.organization.update({
        where: { id: input.organizationId },
        data: orgUpdate,
      });
    }
  }

  if (input.planId) {
    const plan = await prisma.plan.findUnique({
      where: { id: input.planId },
      select: { legacyPlanTier: true, limits: true },
    });
    if (plan?.legacyPlanTier) {
      const orgUpdate: Prisma.OrganizationUpdateInput = { planTier: plan.legacyPlanTier };
      const limits = plan.limits as Record<string, unknown> | null;
      if (limits && typeof limits.messages === "number") {
        orgUpdate.monthlyMessageQuota = limits.messages;
      }
      await prisma.organization.update({ where: { id: input.organizationId }, data: orgUpdate });
    }
  }

  return { organizationId: input.organizationId, planId: input.planId, status: input.status };
}

/**
 * Persiste snapshot Stripe → OrganizationSubscription + plan_tier legado na Organization.
 */
export async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  organizationIdHint?: string | null,
): Promise<SyncSubscriptionResult | null> {
  const organizationId =
    organizationIdHint?.trim() ||
    subscription.metadata?.organizationId?.trim() ||
    subscription.metadata?.opennexoOrgId?.trim() ||
    null;

  if (!organizationId) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    if (customerId) {
      const org = await prisma.organization.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      });
      if (org) return syncSubscriptionFromStripe(subscription, org.id);
    }
    return null;
  }

  const planId = await resolvePlanIdFromStripeSubscription(subscription);
  const status = mapStripeSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const period = getSubscriptionBillingPeriod(subscription);

  return syncSubscriptionSnapshot({
    organizationId,
    planId,
    paymentProvider: "stripe",
    status,
    externalCustomerId: customerId,
    externalSubscriptionId: subscription.id,
    externalPriceId: priceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodStart: stripeUnixToDate(period.currentPeriodStart),
    currentPeriodEnd: stripeUnixToDate(period.currentPeriodEnd),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    canceledAt: stripeUnixToDate(subscription.canceled_at),
    trialStart: stripeUnixToDate(subscription.trial_start),
    trialEnd: stripeUnixToDate(subscription.trial_end),
    checkoutSessionId: null,
    clearPaymentDue: status === "active" || status === "trialing",
  });
}

export type MercadoPagoPreapprovalSnapshot = {
  id: string;
  status?: string | null;
  preapproval_plan_id?: string | null;
  payer_id?: number | string | null;
  payer_email?: string | null;
  external_reference?: string | null;
  next_payment_date?: string | null;
  date_created?: string | null;
  last_modified?: string | null;
  auto_recurring?: {
    start_date?: string | null;
    end_date?: string | null;
  } | null;
};

function parseMercadoPagoDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Avança a data de acordo com o intervalo do plano (month/year). */
export function addPlanIntervalToDate(start: Date, interval: string): Date {
  const end = new Date(start.getTime());
  if (interval === "year") {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end;
}

/** Resolve início/fim do período de cobrança Mercado Pago (Renovação na UI). */
export function resolveMercadoPagoBillingPeriod(params: {
  periodStart?: Date | null;
  nextPaymentDate?: Date | null;
  planInterval?: string | null;
}): { currentPeriodStart: Date | null; currentPeriodEnd: Date | null } {
  const start = params.periodStart ?? null;
  if (!start) return { currentPeriodStart: null, currentPeriodEnd: null };

  const nextPayment = params.nextPaymentDate;
  if (nextPayment && nextPayment.getTime() > start.getTime()) {
    return { currentPeriodStart: start, currentPeriodEnd: nextPayment };
  }

  const interval = params.planInterval?.trim();
  if (interval) {
    return {
      currentPeriodStart: start,
      currentPeriodEnd: addPlanIntervalToDate(start, interval),
    };
  }

  return { currentPeriodStart: start, currentPeriodEnd: null };
}

export function parseMercadoPagoDateString(value: string | null | undefined): Date | null {
  return parseMercadoPagoDate(value);
}

/** Preenche Renovação em assinaturas MP activas criadas antes do cálculo de período. */
export async function ensureMercadoPagoSubscriptionBillingPeriod(organizationId: string): Promise<void> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      status: true,
      paymentProvider: true,
      currentPeriodEnd: true,
      currentPeriodStart: true,
      updatedAt: true,
      plan: { select: { interval: true } },
    },
  });
  if (!sub || sub.paymentProvider !== "mercadopago") return;
  if (sub.status !== "active" && sub.status !== "trialing") return;
  if (sub.currentPeriodEnd) return;
  if (!sub.plan?.interval) return;

  const billingPeriod = resolveMercadoPagoBillingPeriod({
    periodStart: sub.currentPeriodStart ?? sub.updatedAt,
    planInterval: sub.plan.interval,
  });
  if (!billingPeriod.currentPeriodEnd) return;

  await prisma.organizationSubscription.update({
    where: { organizationId },
    data: {
      currentPeriodStart: billingPeriod.currentPeriodStart ?? undefined,
      currentPeriodEnd: billingPeriod.currentPeriodEnd,
    },
  });
}

export function resolveOrganizationIdFromMercadoPagoReference(
  externalReference: string | null | undefined,
): string | null {
  const ref = externalReference?.trim();
  if (!ref?.startsWith("ONX-")) return null;
  const parts = ref.split("-");
  if (parts.length < 7) return null;
  return parts.slice(1, 6).join("-");
}

export async function syncSubscriptionFromMercadoPago(
  preapproval: MercadoPagoPreapprovalSnapshot,
  organizationIdHint?: string | null,
): Promise<SyncSubscriptionResult | null> {
  const organizationId =
    organizationIdHint?.trim() ||
    resolveOrganizationIdFromMercadoPagoReference(preapproval.external_reference) ||
    null;

  if (!organizationId) {
    const existing = preapproval.id?.trim()
      ? await prisma.organizationSubscription.findFirst({
          where: { externalSubscriptionId: preapproval.id },
          select: { organizationId: true },
        })
      : null;
    if (!existing?.organizationId) return null;
    return syncSubscriptionFromMercadoPago(preapproval, existing.organizationId);
  }

  const planId = preapproval.preapproval_plan_id
    ? await resolvePlanIdFromMercadoPagoPlanId(preapproval.preapproval_plan_id)
    : (
        await prisma.organizationSubscription.findUnique({
          where: { organizationId },
          select: { planId: true },
        })
      )?.planId ?? null;

  const status = mapMercadoPagoPreapprovalStatus(preapproval.status ?? "pending");
  const payerId = preapproval.payer_id != null ? String(preapproval.payer_id) : null;

  const plan = planId
    ? await prisma.plan.findUnique({ where: { id: planId }, select: { interval: true } })
    : null;
  const billingPeriod = resolveMercadoPagoBillingPeriod({
    periodStart:
      parseMercadoPagoDate(preapproval.auto_recurring?.start_date) ??
      parseMercadoPagoDate(preapproval.date_created),
    nextPaymentDate: parseMercadoPagoDate(preapproval.next_payment_date),
    planInterval: plan?.interval ?? null,
  });

  return syncSubscriptionSnapshot({
    organizationId,
    planId,
    paymentProvider: "mercadopago",
    status,
    externalCustomerId: payerId,
    externalSubscriptionId: preapproval.id,
    externalPriceId: preapproval.preapproval_plan_id ?? null,
    currentPeriodStart: billingPeriod.currentPeriodStart,
    currentPeriodEnd: billingPeriod.currentPeriodEnd,
    checkoutSessionId: preapproval.id,
    clearPaymentDue: status === "active",
  });
}
