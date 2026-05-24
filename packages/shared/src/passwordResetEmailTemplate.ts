import {
  escapeHtmlForEmailPlaceholder,
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

/** Omissão do assunto do email de recuperação de senha (Resend). */
export const DEFAULT_PASSWORD_RESET_SUBJECT = "OpenNexo CRM — recuperação de palavra-passe";

/**
 * Omissão do HTML. Placeholders: `{{resetUrl}}`, `{{resetUrlText}}`, `{{appName}}`, `{{userName}}`,
 * `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_PASSWORD_RESET_HTML = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá {{userName}},</p>
  <p>Recebemos um pedido para redefinir a palavra-passe da sua conta no <strong>{{appName}}</strong>.</p>
  <p><a href="{{resetUrl}}" style="color: #6366f1;">Redefinir palavra-passe</a></p>
  <p style="font-size: 12px; color: #6b7280;">Se não foi você, ignore este email. O link expira em breve.</p>
  <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">{{resetUrl}}</p>
</body>
</html>`;

export { escapeHtmlForEmailPlaceholder };

const EXTRA_KEYS = ["resetUrl", "resetUrlText", "userName"] as const;

/** Dados de exemplo para pré-visualização no painel (não são URLs reais). */
export const PASSWORD_RESET_PREVIEW_SAMPLE = {
  resetUrl: "https://app.exemplo.com/login/reset?token=exemplo-token-seguro",
  userName: "Maria Silva",
} as const;

export function buildPasswordResetEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: { resetUrl: string; appName: string; userName: string; logoUrl: string },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    resetUrl: vars.resetUrl,
    resetUrlText: vars.resetUrl,
    userName: vars.userName.trim() || "—",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
