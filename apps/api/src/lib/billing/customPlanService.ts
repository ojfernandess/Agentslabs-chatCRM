import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";
import { assignCustomPlanToOrganization } from "./planAssignment.js";

export type UpdateCustomPlanInput = {
  name?: string;
  description?: string | null;
  currency?: string;
  amountCents?: number;
  interval?: "month" | "year";
  paymentGraceDays?: number;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  legacyPlanTier?: "free" | "growth" | "enterprise" | null;
  limits?: Record<string, unknown>;
  features?: Record<string, unknown>;
  trialDays?: number | null;
  isActive?: boolean;
};

export type CreateCustomPlanInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  currency?: string;
  amountCents: number;
  interval?: "month" | "year";
  paymentGraceDays: number;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  legacyPlanTier?: "free" | "growth" | "enterprise" | null;
  limits?: Record<string, unknown>;
  features?: Record<string, unknown>;
  trialDays?: number | null;
};

function normalizeStripeId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

async function uniqueCustomSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  const base = (org?.slug ?? "org").slice(0, 24).replace(/[^a-z0-9-]/g, "-");
  for (let i = 0; i < 5; i++) {
    const suffix = randomBytes(3).toString("hex");
    const slug = `custom-${base}-${suffix}`.slice(0, 64);
    const exists = await prisma.plan.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  throw new BillingError("Could not generate unique plan slug", "slug_conflict");
}

export async function createCustomPlanForOrganization(input: CreateCustomPlanInput) {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, isActive: true },
  });
  if (!org?.isActive) {
    throw new BillingError("Organization not found or inactive", "organization_not_found");
  }

  if (input.amountCents > 0 && !normalizeStripeId(input.stripePriceId)) {
    throw new BillingError("Paid custom plans require stripePriceId", "plan_not_stripe_ready");
  }

  const slug = await uniqueCustomSlug(input.organizationId);
  const graceDays = Math.max(1, Math.min(90, input.paymentGraceDays));

  const plan = await prisma.plan.create({
    data: {
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      currency: (input.currency ?? "BRL").toUpperCase(),
      amountCents: input.amountCents,
      interval: input.interval ?? "month",
      trialDays: input.trialDays ?? null,
      displayOrder: 0,
      isActive: true,
      isCustom: true,
      organizationId: input.organizationId,
      paymentGraceDays: graceDays,
      stripeProductId: normalizeStripeId(input.stripeProductId),
      stripePriceId: normalizeStripeId(input.stripePriceId),
      legacyPlanTier: input.legacyPlanTier ?? null,
      limits: (input.limits ?? {}) as Prisma.InputJsonValue,
      features: (input.features ?? {}) as Prisma.InputJsonValue,
    },
  });

  await assignCustomPlanToOrganization(input.organizationId, plan.id, graceDays);
  return plan;
}

export async function updateCustomPlan(planId: string, input: UpdateCustomPlanInput) {
  const existing = await prisma.plan.findFirst({
    where: { id: planId, isCustom: true },
    select: {
      id: true,
      organizationId: true,
      amountCents: true,
      legacyPlanTier: true,
      limits: true,
    },
  });
  if (!existing?.organizationId) {
    throw new BillingError("Custom plan not found", "plan_not_found");
  }

  const nextAmountCents = input.amountCents ?? existing.amountCents;
  const nextStripePriceId =
    input.stripePriceId !== undefined
      ? normalizeStripeId(input.stripePriceId)
      : undefined;

  if (nextAmountCents > 0) {
    const priceId =
      nextStripePriceId !== undefined
        ? nextStripePriceId
        : (
            await prisma.plan.findUnique({
              where: { id: planId },
              select: { stripePriceId: true },
            })
          )?.stripePriceId;
    if (!priceId) {
      throw new BillingError("Paid custom plans require stripePriceId", "plan_not_stripe_ready");
    }
  }

  const data: Prisma.PlanUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.currency !== undefined) data.currency = input.currency.toUpperCase();
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.interval !== undefined) data.interval = input.interval;
  if (input.trialDays !== undefined) data.trialDays = input.trialDays;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.stripeProductId !== undefined) data.stripeProductId = normalizeStripeId(input.stripeProductId);
  if (input.stripePriceId !== undefined) data.stripePriceId = normalizeStripeId(input.stripePriceId);
  if (input.legacyPlanTier !== undefined) data.legacyPlanTier = input.legacyPlanTier;
  if (input.limits !== undefined) data.limits = input.limits as Prisma.InputJsonValue;
  if (input.features !== undefined) data.features = input.features as Prisma.InputJsonValue;
  if (input.paymentGraceDays !== undefined) {
    data.paymentGraceDays = Math.max(1, Math.min(90, input.paymentGraceDays));
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data,
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      _count: { select: { subscriptions: true } },
    },
  });

  const orgUpdate: Prisma.OrganizationUpdateInput = {};
  if (input.legacyPlanTier !== undefined && input.legacyPlanTier) {
    orgUpdate.planTier = input.legacyPlanTier;
  } else if (plan.legacyPlanTier) {
    orgUpdate.planTier = plan.legacyPlanTier;
  }

  const limits = plan.limits as Record<string, unknown> | null;
  if (limits && typeof limits.messages === "number") {
    orgUpdate.monthlyMessageQuota = limits.messages;
  }

  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId: existing.organizationId },
    select: {
      planId: true,
      status: true,
      stripeSubscriptionId: true,
      customPlanAssignedAt: true,
    },
  });

  const subscriptionUpdate: Prisma.OrganizationSubscriptionUpdateInput = {};
  if (subscription?.planId === plan.id && input.paymentGraceDays !== undefined) {
    const graceDays = Math.max(1, Math.min(90, input.paymentGraceDays));
    if (
      subscription.status === "pending_payment" &&
      !subscription.stripeSubscriptionId?.trim() &&
      plan.amountCents > 0
    ) {
      const base = subscription.customPlanAssignedAt ?? new Date();
      subscriptionUpdate.paymentDueAt = new Date(base.getTime() + graceDays * 86_400_000);
    }
  }

  if (Object.keys(orgUpdate).length > 0 || Object.keys(subscriptionUpdate).length > 0) {
    await prisma.$transaction([
      ...(Object.keys(orgUpdate).length > 0
        ? [
            prisma.organization.update({
              where: { id: existing.organizationId },
              data: orgUpdate,
            }),
          ]
        : []),
      ...(Object.keys(subscriptionUpdate).length > 0
        ? [
            prisma.organizationSubscription.update({
              where: { organizationId: existing.organizationId },
              data: subscriptionUpdate,
            }),
          ]
        : []),
    ]);
  }

  return plan;
}

export async function listCustomPlans(organizationId?: string) {
  return prisma.plan.findMany({
    where: {
      isCustom: true,
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      _count: { select: { subscriptions: true } },
    },
  });
}

/** Planos visíveis para checkout do tenant. */
export async function listPlansForOrganization(organizationId: string) {
  const customPlans = await prisma.plan.findMany({
    where: { organizationId, isActive: true, isCustom: true },
    orderBy: [{ displayOrder: "asc" }, { amountCents: "asc" }],
  });
  if (customPlans.length > 0) return customPlans;

  return prisma.plan.findMany({
    where: { isActive: true, isCustom: false, organizationId: null },
    orderBy: [{ displayOrder: "asc" }, { amountCents: "asc" }],
  });
}

const AWAITING_STRIPE_PAYMENT_STATUSES = new Set([
  "pending_payment",
  "incomplete",
  "incomplete_expired",
]);

export function isAwaitingStripePayment(input: {
  status: string;
  stripeSubscriptionId: string | null;
}): boolean {
  return (
    AWAITING_STRIPE_PAYMENT_STATUSES.has(input.status) &&
    !input.stripeSubscriptionId?.trim()
  );
}

export function computePaymentGraceInfo(input: {
  status: string;
  paymentDueAt: Date | null;
  stripeSubscriptionId: string | null;
  planIsCustom: boolean;
}): {
  paymentPending: boolean;
  canCompletePayment: boolean;
  paymentDueAt: string | null;
  daysRemaining: number | null;
  paymentOverdue: boolean;
} {
  const pending = isAwaitingStripePayment(input);

  if (!pending) {
    return {
      paymentPending: false,
      canCompletePayment: false,
      paymentDueAt: null,
      daysRemaining: null,
      paymentOverdue: false,
    };
  }

  const due = input.paymentDueAt;
  if (!due) {
    return {
      paymentPending: true,
      canCompletePayment: true,
      paymentDueAt: null,
      daysRemaining: null,
      paymentOverdue: false,
    };
  }

  const msLeft = due.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
  return {
    paymentPending: true,
    canCompletePayment: true,
    paymentDueAt: due.toISOString(),
    daysRemaining,
    paymentOverdue: msLeft <= 0,
  };
}
