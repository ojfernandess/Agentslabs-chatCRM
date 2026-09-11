import type Stripe from "stripe";
import { Resend } from "resend";
import {
  buildBillingReminderEmailContent,
  buildPaymentConfirmationEmailContent,
} from "@openconduit/shared";
import { prisma } from "../../db.js";
import { getWebAppPublicOrigin } from "../../config.js";
import {
  getResendEmailConfigFromDb,
  resolveBillingReminderTemplates,
  resolvePaymentConfirmationTemplates,
  resolveSystemLogoUrl,
  type ResendEmailConfig,
} from "../resendEmailSettings.js";
import { recordBillingAudit } from "./billingAudit.js";
import { resolveBillingEmailWithOverride } from "./billingEmailRecipients.js";
import { getStripeClient } from "./stripeClient.js";

const RECEIPT_NOTE_PT =
  "Pode descarregar os recibos e consultar o histórico de faturas em Configurações da organização → Plano e faturação.";

function billingSettingsUrl(): string {
  return `${getWebAppPublicOrigin()}/settings?section=billing`;
}

function formatMoney(cents: number, currency: string, locale = "pt-BR"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDateTime(d: Date | null | undefined, locale = "pt-BR"): string {
  if (!d) return "—";
  return d.toLocaleString(locale);
}

function formatDateOnly(d: Date | null | undefined, locale = "pt-BR"): string {
  if (!d) return "—";
  return d.toLocaleDateString(locale);
}

function daysUntil(date: Date | null | undefined): string {
  if (!date) return "—";
  const diff = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return String(diff);
}

async function sendViaResend(
  cfg: ResendEmailConfig,
  toEmail: string,
  subject: string,
  html: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { data, error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [toEmail],
    subject,
    html,
  });
  if (error) {
    return {
      ok: false,
      error:
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "resend_error",
    };
  }
  if (!data?.id) return { ok: false, error: "no_message_id" };
  return { ok: true };
}

export async function sendBillingReminderEmail(options: {
  toEmail: string;
  organizationName: string;
  planName: string;
  amountDueCents: number;
  currency: string;
  dueDate: Date | null;
  status: string;
  invoiceUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getResendEmailConfigFromDb();
  if (!cfg) return { ok: false, error: "resend_not_configured" };

  const portalUrl = billingSettingsUrl();
  const { subjectTpl, htmlTpl } = resolveBillingReminderTemplates(cfg);
  const { subject, html } = buildBillingReminderEmailContent(subjectTpl, htmlTpl, {
    appName: cfg.fromName,
    logoUrl: resolveSystemLogoUrl(cfg),
    organizationName: options.organizationName,
    planName: options.planName,
    amountDue: formatMoney(options.amountDueCents, options.currency),
    currency: options.currency.toUpperCase(),
    dueDate: formatDateOnly(options.dueDate),
    daysRemaining: daysUntil(options.dueDate),
    invoiceUrl: options.invoiceUrl?.trim() || portalUrl,
    portalUrl,
    billingSettingsUrl: portalUrl,
    status: options.status,
  });

  return sendViaResend(cfg, options.toEmail, subject, html);
}

export async function sendPaymentConfirmationEmail(options: {
  toEmail: string;
  organizationName: string;
  planName: string;
  amountPaidCents: number;
  currency: string;
  paidAt: Date | null;
  invoiceNumber: string;
  invoiceUrl?: string | null;
  status?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getResendEmailConfigFromDb();
  if (!cfg) return { ok: false, error: "resend_not_configured" };

  const settingsUrl = billingSettingsUrl();
  const { subjectTpl, htmlTpl } = resolvePaymentConfirmationTemplates(cfg);
  const { subject, html } = buildPaymentConfirmationEmailContent(subjectTpl, htmlTpl, {
    appName: cfg.fromName,
    logoUrl: resolveSystemLogoUrl(cfg),
    organizationName: options.organizationName,
    planName: options.planName,
    amountPaid: formatMoney(options.amountPaidCents, options.currency),
    currency: options.currency.toUpperCase(),
    paidAt: formatDateTime(options.paidAt),
    invoiceNumber: options.invoiceNumber,
    invoiceUrl: options.invoiceUrl?.trim() || settingsUrl,
    billingSettingsUrl: settingsUrl,
    receiptNote: RECEIPT_NOTE_PT,
    status: options.status ?? "paid",
  });

  return sendViaResend(cfg, options.toEmail, subject, html);
}

async function loadOrgBillingContext(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      billingEmail: true,
      subscription: {
        select: {
          status: true,
          currentPeriodEnd: true,
          paymentDueAt: true,
          plan: {
            select: { name: true, amountCents: true, currency: true },
          },
        },
      },
    },
  });
}

/** Envio manual de lembrete (Super Admin). */
export async function sendOrganizationPaymentReminder(options: {
  organizationId: string;
  billingEmail?: string | null;
  actorUserId?: string;
  ip?: string | null;
}): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const toEmail = await resolveBillingEmailWithOverride(options.organizationId, options.billingEmail);
  if (!toEmail) return { ok: false, error: "billing_email_missing" };

  const org = await loadOrgBillingContext(options.organizationId);
  if (!org) return { ok: false, error: "organization_not_found" };

  const sub = org.subscription;
  const plan = sub?.plan;
  const dueDate = sub?.paymentDueAt ?? sub?.currentPeriodEnd ?? null;
  const amountCents = plan?.amountCents ?? 0;
  const currency = plan?.currency ?? "BRL";

  let invoiceUrl: string | null = null;
  if (org.subscription?.status === "past_due" || org.subscription?.status === "active") {
    try {
      const stripeOrg = await prisma.organization.findUnique({
        where: { id: options.organizationId },
        select: { stripeCustomerId: true },
      });
      if (stripeOrg?.stripeCustomerId) {
        const stripe = getStripeClient();
        const invoices = await stripe.invoices.list({
          customer: stripeOrg.stripeCustomerId,
          status: "open",
          limit: 1,
        });
        invoiceUrl = invoices.data[0]?.hosted_invoice_url ?? null;
      }
    } catch {
      /* optional Stripe lookup */
    }
  }

  const result = await sendBillingReminderEmail({
    toEmail,
    organizationName: org.name,
    planName: plan?.name ?? org.subscription?.status ?? "Plano",
    amountDueCents: amountCents,
    currency,
    dueDate,
    status: sub?.status ?? "pending",
    invoiceUrl,
  });

  if (!result.ok) return result;

  await recordBillingAudit({
    action: "billing.reminder_sent",
    organizationId: options.organizationId,
    actorUserId: options.actorUserId,
    metadata: { sentTo: toEmail, manual: true },
    ip: options.ip,
  });

  return { ok: true, sentTo: toEmail };
}

export async function trySendStripeInvoicePaymentConfirmation(
  invoice: Stripe.Invoice,
  organizationId: string,
): Promise<void> {
  try {
    const toEmail = await resolveBillingEmailWithOverride(organizationId, null);
    if (!toEmail) return;

    const org = await loadOrgBillingContext(organizationId);
    if (!org) return;

    const planName = org.subscription?.plan?.name ?? "Plano";
    const paidAt =
      invoice.status_transitions?.paid_at != null
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : new Date();

    const result = await sendPaymentConfirmationEmail({
      toEmail,
      organizationName: org.name,
      planName,
      amountPaidCents: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? org.subscription?.plan?.currency ?? "BRL",
      paidAt,
      invoiceNumber: invoice.number ?? invoice.id,
      invoiceUrl: invoice.hosted_invoice_url,
      status: invoice.status ?? "paid",
    });

    if (result.ok) {
      await recordBillingAudit({
        action: "billing.confirmation_email_sent",
        organizationId,
        resourceId: invoice.id,
        metadata: { sentTo: toEmail },
      });
    }
  } catch {
    /* never break webhook processing */
  }
}

export async function trySendStripeInvoicePaymentReminder(
  invoice: Stripe.Invoice,
  organizationId: string,
): Promise<void> {
  try {
    const toEmail = await resolveBillingEmailWithOverride(organizationId, null);
    if (!toEmail) return;

    const org = await loadOrgBillingContext(organizationId);
    if (!org) return;

    const dueDate =
      invoice.due_date != null ? new Date(invoice.due_date * 1000) : org.subscription?.currentPeriodEnd ?? null;

    const result = await sendBillingReminderEmail({
      toEmail,
      organizationName: org.name,
      planName: org.subscription?.plan?.name ?? "Plano",
      amountDueCents: invoice.amount_due ?? org.subscription?.plan?.amountCents ?? 0,
      currency: invoice.currency ?? org.subscription?.plan?.currency ?? "BRL",
      dueDate,
      status: invoice.status ?? org.subscription?.status ?? "past_due",
      invoiceUrl: invoice.hosted_invoice_url,
    });

    if (result.ok) {
      await recordBillingAudit({
        action: "billing.reminder_sent",
        organizationId,
        resourceId: invoice.id,
        metadata: { sentTo: toEmail, source: "stripe_webhook" },
      });
    }
  } catch {
    /* never break webhook processing */
  }
}
