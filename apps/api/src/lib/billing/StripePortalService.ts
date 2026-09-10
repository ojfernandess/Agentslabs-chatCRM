import { config, getWebAppPublicOrigin } from "../../config.js";
import { recordBillingAudit } from "./billingAudit.js";
import { BillingError, ensureStripeCustomer } from "./StripeCustomerService.js";
import { getStripeClient } from "./stripeClient.js";

export type CreatePortalSessionInput = {
  organizationId: string;
  actorUserId: string;
  returnUrl?: string;
  ip?: string | null;
};

export async function createBillingPortalSession(
  input: CreatePortalSessionInput,
): Promise<{ url: string }> {
  const customerId = await ensureStripeCustomer(input.organizationId);
  const stripe = getStripeClient();
  const returnUrl =
    input.returnUrl?.trim() ||
    `${getWebAppPublicOrigin()}/settings?section=billing`;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  if (!session.url) {
    throw new BillingError("Stripe Portal did not return a URL", "portal_no_url");
  }

  await recordBillingAudit({
    action: "billing.portal_opened",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceId: session.id,
    ip: input.ip,
  });

  return { url: session.url };
}

/** Publishable key exposta ao frontend (sem secret). */
export function getStripePublishableKeyForClient(): string | null {
  const key = config.stripePublishableKey.trim();
  return key || null;
}
