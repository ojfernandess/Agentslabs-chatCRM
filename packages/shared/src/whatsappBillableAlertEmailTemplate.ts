import {
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

export const DEFAULT_WHATSAPP_BILLABLE_ALERT_SUBJECT =
  "WhatsApp — mensagens cobráveis — {{organizationName}} ({{monthKey}})";

/**
 * Placeholders: `{{organizationName}}`, `{{billableCount}}`, `{{monthKey}}`,
 * `{{appName}}`, `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_WHATSAPP_BILLABLE_ALERT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá,</p>
  <p>A organização <strong>{{organizationName}}</strong> passou a ter mensagens WhatsApp <strong>cobráveis</strong> no mês <strong>{{monthKey}}</strong>.</p>
  <p>Total cobrável no mês <strong>{{monthKey}}</strong>: <strong>{{billableCount}}</strong>.</p>
  <p>Contacte o suporte da plataforma ou consulte a política de consumo WhatsApp para detalhes por categoria.</p>
  <p style="font-size: 12px; color: #6b7280;">Enviado pelo {{appName}}.</p>
</body>
</html>`;

export const WHATSAPP_BILLABLE_ALERT_PREVIEW_SAMPLE = {
  organizationName: "Hotel Exemplo",
  billableCount: "13",
  monthKey: "2026-09",
} as const;

const EXTRA_KEYS = ["organizationName", "billableCount", "monthKey"] as const;

export function buildWhatsappBillableAlertEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: {
    appName: string;
    logoUrl: string;
    organizationName: string;
    billableCount: string;
    monthKey: string;
  },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    organizationName: vars.organizationName.trim() || "—",
    billableCount: vars.billableCount.trim() || "—",
    monthKey: vars.monthKey.trim() || "—",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
