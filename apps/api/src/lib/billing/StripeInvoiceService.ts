import { prisma } from "../../db.js";
import { getStripeClient } from "./stripeClient.js";
export type BillingInvoiceRow = {
  id: string;
  number: string | null;
  status: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  created: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

export async function listOrganizationInvoices(
  organizationId: string,
  limit = 24,
): Promise<BillingInvoiceRow[]> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId) return [];

  const stripe = getStripeClient();
  const page = await stripe.invoices.list({
    customer: org.stripeCustomerId,
    limit: Math.min(Math.max(limit, 1), 100),
  });

  return page.data.map((inv) => ({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    amountPaid: inv.amount_paid,
    amountDue: inv.amount_due,
    currency: inv.currency,
    created: new Date(inv.created * 1000).toISOString(),
    periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
    periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
  }));
}
