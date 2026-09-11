import type Stripe from "stripe";
import { prisma } from "../../db.js";
import { clearOrganizationStripeBindings } from "./clearStripeBindings.js";
import { getStripeClient } from "./stripeClient.js";
import { isStaleStripeBindingError } from "./stripeErrors.js";

export class BillingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

async function resolveBillingEmail(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      billingEmail: true,
      users: {
        where: { role: "ADMIN" },
        select: { email: true },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!org) return null;
  if (org.billingEmail?.trim()) return org.billingEmail.trim();
  return org.users[0]?.email?.trim() ?? null;
}

async function createStripeCustomer(organizationId: string, orgName: string): Promise<string> {
  const email = await resolveBillingEmail(organizationId);
  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    name: orgName,
    ...(email ? { email } : {}),
    metadata: { organizationId, opennexoOrgId: organizationId },
  });

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customer.id },
    }),
    prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        stripeCustomerId: customer.id,
        status: "inactive",
      },
      update: { stripeCustomerId: customer.id },
    }),
  ]);

  return customer.id;
}

async function resolveExistingStripeCustomerId(
  organizationId: string,
  orgName: string,
  existing: string,
): Promise<string> {
  const stripe = getStripeClient();
  try {
    await stripe.customers.retrieve(existing);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: existing },
    });
    return existing;
  } catch (err) {
    if (!isStaleStripeBindingError(err)) throw err;
    await clearOrganizationStripeBindings(organizationId);
    return createStripeCustomer(organizationId, orgName);
  }
}

/**
 * Garante um único Stripe Customer por organização.
 * Persiste `organizations.stripe_customer_id` e espelha em `organization_subscriptions`.
 * Se o ID guardado for de test mode e a chave for live (ou vice-versa), recria o customer.
 */
export async function ensureStripeCustomer(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      subscription: { select: { id: true, stripeCustomerId: true } },
    },
  });
  if (!org) throw new BillingError("Organization not found", "org_not_found");

  const existing =
    org.stripeCustomerId?.trim() || org.subscription?.stripeCustomerId?.trim() || null;
  if (existing) {
    return resolveExistingStripeCustomerId(organizationId, org.name, existing);
  }

  return createStripeCustomer(organizationId, org.name);
}

export async function updateStripeCustomerFromOrganization(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, stripeCustomerId: true, billingEmail: true },
  });
  if (!org?.stripeCustomerId) return;

  const email = org.billingEmail?.trim() || (await resolveBillingEmail(organizationId));
  const stripe = getStripeClient();
  const payload: Stripe.CustomerUpdateParams = { name: org.name };
  if (email) payload.email = email;

  try {
    await stripe.customers.update(org.stripeCustomerId, payload);
  } catch (err) {
    if (!isStaleStripeBindingError(err)) throw err;
    await clearOrganizationStripeBindings(organizationId);
  }
}
