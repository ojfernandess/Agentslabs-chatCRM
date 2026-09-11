import { prisma } from "../../db.js";

/**
 * Remove IDs Stripe persistidos (test/live) para permitir novo checkout no modo actual.
 * Não altera planTier nem entitlements locais — apenas ligações Stripe.
 */
export async function clearOrganizationStripeBindings(organizationId: string): Promise<void> {
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: null },
    }),
    prisma.organizationSubscription.updateMany({
      where: { organizationId },
      data: {
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        checkoutSessionId: null,
      },
    }),
  ]);
}

export async function clearAllOrganizationStripeBindings(): Promise<{
  organizationsCleared: number;
  subscriptionsCleared: number;
}> {
  const [orgResult, subResult] = await prisma.$transaction([
    prisma.organization.updateMany({
      where: { stripeCustomerId: { not: null } },
      data: { stripeCustomerId: null },
    }),
    prisma.organizationSubscription.updateMany({
      where: {
        OR: [
          { stripeCustomerId: { not: null } },
          { stripeSubscriptionId: { not: null } },
          { stripePriceId: { not: null } },
          { checkoutSessionId: { not: null } },
        ],
      },
      data: {
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        checkoutSessionId: null,
      },
    }),
  ]);

  return {
    organizationsCleared: orgResult.count,
    subscriptionsCleared: subResult.count,
  };
}

/** Limpa Product/Price IDs dos planos — necessário ao trocar test → live no Super Admin. */
export async function clearPlanStripeIds(): Promise<{ plansCleared: number }> {
  const result = await prisma.plan.updateMany({
    where: {
      OR: [{ stripeProductId: { not: null } }, { stripePriceId: { not: null } }],
    },
    data: {
      stripeProductId: null,
      stripePriceId: null,
    },
  });
  return { plansCleared: result.count };
}
