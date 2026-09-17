import { prisma } from "../../../db.js";
import type { BillingInvoiceRow } from "../StripeInvoiceService.js";
import {
  getMercadoPagoPayment,
} from "./MercadoPagoPixPaymentService.js";
import {
  MercadoPagoApiError,
  mercadoPagoRequest,
  resolveMercadoPagoAccessTokenForBilling,
} from "./mercadoPagoClient.js";

type MercadoPagoAuthorizedPayment = {
  id?: number | string;
  preapproval_id?: string;
  payment_id?: number | string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string | null;
  debit_date?: string | null;
  payment?: {
    id?: number | string;
    status?: string;
    status_detail?: string;
  } | null;
};

type MercadoPagoAuthorizedPaymentSearchResponse = {
  paging?: { total?: number };
  results?: MercadoPagoAuthorizedPayment[];
};

export type MercadoPagoPaymentInvoiceSource = {
  id: number | string;
  status?: string;
  status_detail?: string;
  date_created?: string | null;
  date_approved?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string | null;
  point_of_interaction?: {
    transaction_data?: {
      ticket_url?: string;
    };
  };
  transaction_details?: {
    external_resource_url?: string;
  };
};

function mercadoPagoAmountToCents(amount: number | undefined): number {
  if (amount == null || Number.isNaN(amount)) return 0;
  return Math.round(Number(amount) * 100);
}

function parseMercadoPagoInvoiceDate(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function normalizeMercadoPagoInvoiceStatus(
  paymentStatus: string | null | undefined,
  authorizedStatus?: string | null,
): string {
  const payment = paymentStatus?.trim().toLowerCase() ?? "";
  const authorized = authorizedStatus?.trim().toLowerCase() ?? "";

  if (payment === "approved" || authorized === "processed" || authorized === "approved") {
    return "paid";
  }
  if (
    payment === "pending" ||
    payment === "in_process" ||
    payment === "in_mediation" ||
    authorized === "scheduled" ||
    authorized === "pending"
  ) {
    return "open";
  }
  if (
    payment === "rejected" ||
    payment === "cancelled" ||
    payment === "canceled" ||
    payment === "refunded" ||
    payment === "charged_back" ||
    authorized === "rejected" ||
    authorized === "cancelled" ||
    authorized === "canceled"
  ) {
    return "void";
  }
  return payment || authorized || "open";
}

export function resolveMercadoPagoReceiptUrl(payment: MercadoPagoPaymentInvoiceSource): string | null {
  return (
    payment.point_of_interaction?.transaction_data?.ticket_url?.trim() ||
    payment.transaction_details?.external_resource_url?.trim() ||
    null
  );
}

export function mapMercadoPagoPaymentToInvoiceRow(
  payment: MercadoPagoPaymentInvoiceSource,
): BillingInvoiceRow {
  const paymentId = String(payment.id ?? "").trim();
  return {
    id: paymentId,
    number: paymentId || null,
    status: normalizeMercadoPagoInvoiceStatus(payment.status),
    amountPaid: mercadoPagoAmountToCents(payment.transaction_amount),
    amountDue: 0,
    currency: (payment.currency_id ?? "BRL").toLowerCase(),
    created: parseMercadoPagoInvoiceDate(payment.date_approved, payment.date_created),
    periodStart: null,
    periodEnd: null,
    hostedInvoiceUrl: resolveMercadoPagoReceiptUrl(payment),
    invoicePdf: null,
  };
}

export function mapMercadoPagoAuthorizedPaymentToInvoiceRow(
  authorizedPayment: MercadoPagoAuthorizedPayment,
): BillingInvoiceRow {
  const paymentId = authorizedPayment.payment?.id ?? authorizedPayment.payment_id ?? authorizedPayment.id;
  const id = String(paymentId ?? authorizedPayment.id ?? "").trim();
  const status = normalizeMercadoPagoInvoiceStatus(
    authorizedPayment.payment?.status,
    authorizedPayment.status,
  );
  const amountPaid =
    status === "paid" ? mercadoPagoAmountToCents(authorizedPayment.transaction_amount) : 0;

  return {
    id: id || String(authorizedPayment.id ?? ""),
    number: id || (authorizedPayment.id != null ? String(authorizedPayment.id) : null),
    status,
    amountPaid,
    amountDue: status === "paid" ? 0 : mercadoPagoAmountToCents(authorizedPayment.transaction_amount),
    currency: (authorizedPayment.currency_id ?? "BRL").toLowerCase(),
    created: parseMercadoPagoInvoiceDate(
      authorizedPayment.debit_date,
      authorizedPayment.date_created,
    ),
    periodStart: null,
    periodEnd: null,
    hostedInvoiceUrl: null,
    invoicePdf: null,
  };
}

function isMercadoPagoNumericPaymentId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function sortInvoiceRowsDesc(rows: BillingInvoiceRow[]): BillingInvoiceRow[] {
  return [...rows].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
  );
}

async function searchAuthorizedPayments(
  accessToken: string,
  preapprovalId: string,
  limit: number,
): Promise<MercadoPagoAuthorizedPayment[]> {
  try {
    const response = await mercadoPagoRequest<MercadoPagoAuthorizedPaymentSearchResponse>({
      accessToken,
      method: "GET",
      path:
        `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}` +
        `&offset=0&limit=${Math.min(Math.max(limit, 1), 50)}`,
    });
    return response.results ?? [];
  } catch (err) {
    if (err instanceof MercadoPagoApiError && (err.statusCode === 404 || err.statusCode === 400)) {
      return [];
    }
    throw err;
  }
}

async function listMercadoPagoPaymentIdsFromAudit(
  organizationId: string,
  limit: number,
): Promise<string[]> {
  const logs = await prisma.auditLog.findMany({
    where: {
      organizationId,
      resourceType: "billing",
      action: "billing.payment_succeeded",
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50) * 2,
    select: { resourceId: true, metadata: true },
  });

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const metadata = log.metadata as Record<string, unknown> | null;
    const provider = typeof metadata?.provider === "string" ? metadata.provider.trim().toLowerCase() : "";
    if (provider && provider !== "mercadopago") continue;

    const resourceId = log.resourceId?.trim();
    if (!resourceId || !isMercadoPagoNumericPaymentId(resourceId) || seen.has(resourceId)) continue;
    seen.add(resourceId);
    ids.push(resourceId);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function fetchMercadoPagoPaymentsByIds(
  accessToken: string,
  paymentIds: string[],
): Promise<MercadoPagoPaymentInvoiceSource[]> {
  const payments = await Promise.all(
    paymentIds.map(async (paymentId) => {
      try {
        return await getMercadoPagoPayment(accessToken, paymentId);
      } catch {
        return null;
      }
    }),
  );
  return payments.filter((payment): payment is MercadoPagoPaymentInvoiceSource => payment != null);
}

export async function listOrganizationMercadoPagoInvoices(
  organizationId: string,
  limit = 24,
): Promise<BillingInvoiceRow[]> {
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: {
      externalSubscriptionId: true,
      paymentProvider: true,
    },
  });

  const externalSubscriptionId = subscription?.externalSubscriptionId?.trim();
  if (!externalSubscriptionId || subscription?.paymentProvider !== "mercadopago") {
    return [];
  }

  const accessToken = await resolveMercadoPagoAccessTokenForBilling(organizationId);
  const cappedLimit = Math.min(Math.max(limit, 1), 50);

  if (!isMercadoPagoNumericPaymentId(externalSubscriptionId)) {
    const authorizedPayments = await searchAuthorizedPayments(
      accessToken,
      externalSubscriptionId,
      cappedLimit,
    );
    if (authorizedPayments.length > 0) {
      return sortInvoiceRowsDesc(
        authorizedPayments.map(mapMercadoPagoAuthorizedPaymentToInvoiceRow).slice(0, cappedLimit),
      );
    }
  }

  const paymentIds = await listMercadoPagoPaymentIdsFromAudit(organizationId, cappedLimit);
  if (!paymentIds.includes(externalSubscriptionId)) {
    paymentIds.unshift(externalSubscriptionId);
  }

  const uniquePaymentIds = [...new Set(paymentIds)].slice(0, cappedLimit);
  const payments = await fetchMercadoPagoPaymentsByIds(accessToken, uniquePaymentIds);
  return sortInvoiceRowsDesc(
    payments.map(mapMercadoPagoPaymentToInvoiceRow).slice(0, cappedLimit),
  );
}
