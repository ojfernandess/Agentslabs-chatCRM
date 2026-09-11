import {
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

export const DEFAULT_PAYMENT_CONFIRMATION_SUBJECT =
  "OpenNexo CRM — pagamento confirmado ({{organizationName}})";

/**
 * Placeholders: `{{organizationName}}`, `{{planName}}`, `{{amountPaid}}`, `{{currency}}`,
 * `{{paidAt}}`, `{{invoiceNumber}}`, `{{invoiceUrl}}`, `{{billingSettingsUrl}}`, `{{receiptNote}}`,
 * `{{status}}`, `{{appName}}`, `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_PAYMENT_CONFIRMATION_HTML = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá,</p>
  <p>Confirmámos o recebimento do pagamento do plano <strong>{{planName}}</strong> para a organização <strong>{{organizationName}}</strong>.</p>
  <p><strong>Valor pago:</strong> {{amountPaid}} {{currency}}<br />
  <strong>Data:</strong> {{paidAt}}<br />
  <strong>Fatura:</strong> {{invoiceNumber}}<br />
  <strong>Estado:</strong> {{status}}</p>
  <p><a href="{{invoiceUrl}}" style="color: #6366f1;">Ver fatura no Stripe</a></p>
  <p style="font-size: 12px; color: #6b7280;">{{receiptNote}}</p>
</body>
</html>`;

export const PAYMENT_CONFIRMATION_PREVIEW_SAMPLE = {
  organizationName: "Hotel Exemplo",
  planName: "Growth",
  amountPaid: "R$ 299,00",
  currency: "BRL",
  paidAt: "11/09/2026 14:30",
  invoiceNumber: "INV-2026-001",
  invoiceUrl: "https://invoice.stripe.com/i/example",
  billingSettingsUrl: "https://app.exemplo.com/settings?section=billing",
  status: "paid",
  receiptNote:
    "Pode descarregar os recibos e consultar o histórico de faturas em Configurações da organização → Plano e faturação.",
} as const;

const EXTRA_KEYS = [
  "organizationName",
  "planName",
  "amountPaid",
  "currency",
  "paidAt",
  "invoiceNumber",
  "invoiceUrl",
  "billingSettingsUrl",
  "receiptNote",
  "status",
] as const;

export function buildPaymentConfirmationEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: {
    appName: string;
    logoUrl: string;
    organizationName: string;
    planName: string;
    amountPaid: string;
    currency: string;
    paidAt: string;
    invoiceNumber: string;
    invoiceUrl: string;
    billingSettingsUrl: string;
    receiptNote: string;
    status: string;
  },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    organizationName: vars.organizationName.trim() || "—",
    planName: vars.planName.trim() || "—",
    amountPaid: vars.amountPaid.trim() || "—",
    currency: vars.currency.trim() || "—",
    paidAt: vars.paidAt.trim() || "—",
    invoiceNumber: vars.invoiceNumber.trim() || "—",
    invoiceUrl: vars.invoiceUrl.trim() || vars.billingSettingsUrl,
    billingSettingsUrl: vars.billingSettingsUrl.trim() || "—",
    receiptNote: vars.receiptNote.trim() || "—",
    status: vars.status.trim() || "paid",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
