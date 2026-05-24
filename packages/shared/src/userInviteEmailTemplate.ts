import {
  fillTransactionalHtml,
  fillTransactionalSubject,
  type TransactionalTemplateVars,
} from "./transactionalEmailPlaceholders.js";

export const DEFAULT_USER_INVITE_SUBJECT = "OpenNexo CRM — convite para criar conta";

/**
 * Placeholders: `{{inviteUrl}}`, `{{inviteUrlText}}`, `{{userName}}`, `{{organizationName}}`,
 * `{{appName}}`, `{{logoUrl}}`, `{{logoHtml}}`.
 */
export const DEFAULT_USER_INVITE_HTML = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  {{logoHtml}}
  <p>Olá,</p>
  <p>Foi convidado(a) a juntar-se à organização <strong>{{organizationName}}</strong> no <strong>{{appName}}</strong>.</p>
  <p><a href="{{inviteUrl}}" style="color: #6366f1;">Criar a minha conta</a></p>
  <p style="font-size: 12px; color: #6b7280;">Se não esperava este convite, ignore este email. O link expira em breve.</p>
  <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">{{inviteUrl}}</p>
</body>
</html>`;

export const USER_INVITE_PREVIEW_SAMPLE = {
  inviteUrl: "https://app.exemplo.com/login/invite?token=exemplo-token-seguro",
  userName: "Maria Silva",
  organizationName: "Hotel Exemplo",
} as const;

const EXTRA_KEYS = ["inviteUrl", "inviteUrlText", "userName", "organizationName"] as const;

export function buildUserInviteEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: {
    inviteUrl: string;
    appName: string;
    logoUrl: string;
    userName: string;
    organizationName: string;
  },
): { subject: string; html: string } {
  const base: TransactionalTemplateVars = {
    appName: vars.appName,
    logoUrl: vars.logoUrl,
    inviteUrl: vars.inviteUrl,
    inviteUrlText: vars.inviteUrl,
    userName: vars.userName.trim() || "—",
    organizationName: vars.organizationName.trim() || "—",
  };
  const html = fillTransactionalHtml(htmlTpl, base, [...EXTRA_KEYS]);
  const subject = fillTransactionalSubject(subjectTpl, base, [...EXTRA_KEYS]);
  return { subject, html };
}
