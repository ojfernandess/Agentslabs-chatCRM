import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";
import { assignCustomPlanToOrganization } from "./planAssignment.js";

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

export function computePaymentGraceInfo(input: {
  status: string;
  paymentDueAt: Date | null;
  stripeSubscriptionId: string | null;
  planIsCustom: boolean;
}): {
  paymentPending: boolean;
  paymentDueAt: string | null;
  daysRemaining: number | null;
  paymentOverdue: boolean;
} {
  const pending =
    input.planIsCustom &&
    input.status === "pending_payment" &&
    !input.stripeSubscriptionId?.trim();

  if (!pending) {
    return {
      paymentPending: false,
      paymentDueAt: null,
      daysRemaining: null,
      paymentOverdue: false,
    };
  }

  const due = input.paymentDueAt;
  if (!due) {
    return {
      paymentPending: true,
      paymentDueAt: null,
      daysRemaining: null,
      paymentOverdue: false,
    };
  }

  const msLeft = due.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
  return {
    paymentPending: true,
    paymentDueAt: due.toISOString(),
    daysRemaining,
    paymentOverdue: msLeft <= 0,
  };
}
