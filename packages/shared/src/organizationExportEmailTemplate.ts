import {
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

export const DEFAULT_ORGANIZATION_EXPORT_SUBJECT =
  "Exportação de dados — {{organizationName}} ({{format}})";

/**
 * Placeholders: `{{organizationName}}`, `{{format}}`, `{{contactsCount}}`, `{{conversationsCount}}`,
 * `{{messagesCount}}`, `{{exportedAt}}`, `{{appName}}`, `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_ORGANIZATION_EXPORT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá,</p>
  <p>Segue em anexo a exportação de contatos e conversas da organização <strong>{{organizationName}}</strong>.</p>
  <ul>
    <li><strong>Contatos:</strong> {{contactsCount}}</li>
    <li><strong>Conversas:</strong> {{conversationsCount}}</li>
    <li><strong>Mensagens:</strong> {{messagesCount}}</li>
    <li><strong>Formato:</strong> {{format}}</li>
  </ul>
  <p style="font-size: 12px; color: #6b7280;">Gerado pelo {{appName}} em {{exportedAt}}.</p>
</body>
</html>`;

export const ORGANIZATION_EXPORT_PREVIEW_SAMPLE = {
  organizationName: "Hotel Exemplo",
  format: "HTML",
  contactsCount: "1.248",
  conversationsCount: "356",
  messagesCount: "12.450",
  exportedAt: "21/09/2026, 06:44:00",
} as const;

const EXTRA_KEYS = [
  "organizationName",
  "format",
  "contactsCount",
  "conversationsCount",
  "messagesCount",
  "exportedAt",
] as const;

export function buildOrganizationExportEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: {
    appName: string;
    logoUrl: string;
    organizationName: string;
    format: string;
    contactsCount: string;
    conversationsCount: string;
    messagesCount: string;
    exportedAt: string;
  },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    organizationName: vars.organizationName.trim() || "—",
    format: vars.format.trim() || "—",
    contactsCount: vars.contactsCount.trim() || "—",
    conversationsCount: vars.conversationsCount.trim() || "—",
    messagesCount: vars.messagesCount.trim() || "—",
    exportedAt: vars.exportedAt.trim() || "—",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
