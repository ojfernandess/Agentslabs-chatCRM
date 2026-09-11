import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";

export async function applyCatalogPlanToOrganization(
  organizationId: string,
  planId: string,
): Promise<void> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, isActive: true },
    select: { id: true, legacyPlanTier: true, limits: true },
  });
  if (!plan) {
    throw new BillingError("Plan not found or inactive", "plan_not_found");
  }

  const limits = plan.limits as Record<string, unknown> | null;
  const orgUpdate: Prisma.OrganizationUpdateInput = {};
  if (plan.legacyPlanTier) orgUpdate.planTier = plan.legacyPlanTier;
  if (limits && typeof limits.messages === "number") {
    orgUpdate.monthlyMessageQuota = limits.messages;
  }

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
      },
      update: {
        planId: plan.id,
        status: "active",
      },
    }),
  ]);
}
