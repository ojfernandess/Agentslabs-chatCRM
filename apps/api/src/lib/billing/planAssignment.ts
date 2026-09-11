import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";

function syncOrgFromPlan(
  plan: { legacyPlanTier: string | null; limits: unknown },
): Prisma.OrganizationUpdateInput {
  const limits = plan.limits as Record<string, unknown> | null;
  const orgUpdate: Prisma.OrganizationUpdateInput = {};
  if (plan.legacyPlanTier) orgUpdate.planTier = plan.legacyPlanTier;
  if (limits && typeof limits.messages === "number") {
    orgUpdate.monthlyMessageQuota = limits.messages;
  }
  return orgUpdate;
}

export async function applyCatalogPlanToOrganization(
  organizationId: string,
  planId: string,
): Promise<void> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, isActive: true, isCustom: false },
    select: { id: true, legacyPlanTier: true, limits: true },
  });
  if (!plan) {
    throw new BillingError("Plan not found or inactive", "plan_not_found");
  }

  const orgUpdate = syncOrgFromPlan(plan);

  await prisma.$transaction([
    ...(Object.keys(orgUpdate).length > 0
      ? [
          prisma.organization.update({
            where: { id: organizationId },
            data: orgUpdate,
          }),
        ]
      : []),
    prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        status: "active",
        paymentDueAt: null,
        customPlanAssignedAt: null,
      },
      update: {
        planId: plan.id,
        status: "active",
        paymentDueAt: null,
        customPlanAssignedAt: null,
      },
    }),
  ]);
}

export async function assignCustomPlanToOrganization(
  organizationId: string,
  planId: string,
  paymentGraceDays: number,
): Promise<void> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, isActive: true, isCustom: true, organizationId },
    select: { id: true, legacyPlanTier: true, limits: true, amountCents: true },
  });
  if (!plan) {
    throw new BillingError("Custom plan not found for this organization", "plan_not_found");
  }

  const orgUpdate = syncOrgFromPlan(plan);
  const now = new Date();
  const paymentDueAt = new Date(now.getTime() + paymentGraceDays * 86_400_000);
  const status = plan.amountCents > 0 ? "pending_payment" : "active";

  await prisma.$transaction([
    ...(Object.keys(orgUpdate).length > 0
      ? [
          prisma.organization.update({
            where: { id: organizationId },
            data: orgUpdate,
          }),
        ]
      : []),
    prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        status,
        paymentDueAt: plan.amountCents > 0 ? paymentDueAt : null,
        customPlanAssignedAt: now,
      },
      update: {
        planId: plan.id,
        status,
        paymentDueAt: plan.amountCents > 0 ? paymentDueAt : null,
        customPlanAssignedAt: now,
      },
    }),
  ]);
}
