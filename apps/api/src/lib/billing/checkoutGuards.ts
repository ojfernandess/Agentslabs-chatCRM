import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";
import { isAccessGrantingStatus, subscriptionIsProviderManaged } from "./billingTypes.js";

export async function assertCheckoutAllowed(organizationId: string, targetPlanId: string): Promise<void> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: { select: { id: true, slug: true } } },
  });

  if (!sub) return;

  const awaitingPayment =
    (sub.status === "pending_payment" ||
      sub.status === "incomplete" ||
      sub.status === "incomplete_expired") &&
    !subscriptionIsProviderManaged(sub);

  if (
    sub.planId === targetPlanId &&
    isAccessGrantingStatus(sub.status) &&
    !awaitingPayment
  ) {
    throw new BillingError("Organization already has an active subscription for this plan", "already_subscribed");
  }

  if (isAccessGrantingStatus(sub.status) && subscriptionIsProviderManaged(sub)) {
    throw new BillingError(
      "Use plan change flow for an existing paid subscription",
      "subscription_exists",
    );
  }
}
