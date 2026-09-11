import {
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

export const DEFAULT_BILLING_REMINDER_SUBJECT =
  "OpenNexo CRM — lembrete de vencimento do plano ({{organizationName}})";

/**
 * Placeholders: `{{organizationName}}`, `{{planName}}`, `{{amountDue}}`, `{{currency}}`,
 * `{{dueDate}}`, `{{daysRemaining}}`, `{{invoiceUrl}}`, `{{portalUrl}}`, `{{billingSettingsUrl}}`,
 * `{{status}}`, `{{appName}}`, `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_BILLING_REMINDER_HTML = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá,</p>
  <p>Este é um lembrete de que o plano <strong>{{planName}}</strong> da organização <strong>{{organizationName}}</strong> requer atenção de pagamento.</p>
  <p><strong>Valor em aberto:</strong> {{amountDue}} {{currency}}<br />
  <strong>Vencimento:</strong> {{dueDate}}<br />
  <strong>Estado:</strong> {{status}}</p>
  <p><a href="{{portalUrl}}" style="color: #6366f1;">Gerir pagamento e método de cobrança</a></p>
  <p style="font-size: 12px; color: #6b7280;">Se o pagamento já foi efectuado, ignore este email. Pode actualizar o método de pagamento em Configurações → Plano e faturação.</p>
</body>
</html>`;

export const BILLING_REMINDER_PREVIEW_SAMPLE = {
  organizationName: "Hotel Exemplo",
  planName: "Growth",
  amountDue: "R$ 299,00",
  currency: "BRL",
  dueDate: "15/09/2026",
  daysRemaining: "3",
  status: "past_due",
  invoiceUrl: "https://invoice.stripe.com/i/example",
  portalUrl: "https://app.exemplo.com/settings?section=billing",
  billingSettingsUrl: "https://app.exemplo.com/settings?section=billing",
} as const;

const EXTRA_KEYS = [
  "organizationName",
  "planName",
  "amountDue",
  "currency",
  "dueDate",
  "daysRemaining",
  "invoiceUrl",
  "portalUrl",
  "billingSettingsUrl",
  "status",
] as const;

export function buildBillingReminderEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: {
    appName: string;
    logoUrl: string;
    organizationName: string;
    planName: string;
    amountDue: string;
    currency: string;
    dueDate: string;
    daysRemaining: string;
    invoiceUrl: string;
    portalUrl: string;
    billingSettingsUrl: string;
    status: string;
  },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    organizationName: vars.organizationName.trim() || "—",
    planName: vars.planName.trim() || "—",
    amountDue: vars.amountDue.trim() || "—",
    currency: vars.currency.trim() || "—",
    dueDate: vars.dueDate.trim() || "—",
    daysRemaining: vars.daysRemaining.trim() || "—",
    invoiceUrl: vars.invoiceUrl.trim() || vars.portalUrl,
    portalUrl: vars.portalUrl.trim() || vars.billingSettingsUrl,
    billingSettingsUrl: vars.billingSettingsUrl.trim() || vars.portalUrl,
    status: vars.status.trim() || "—",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
