/** Omissão do assunto do email de recuperação de senha (Resend). */
export const DEFAULT_PASSWORD_RESET_SUBJECT = "OpenNexo CRM — recuperação de palavra-passe";

/**
 * Omissão do HTML. Placeholders: `{{resetUrl}}`, `{{resetUrlText}}`, `{{appName}}`, `{{userName}}`.
 * Manter alinhado com a cópia em `apps/api` / painel super admin.
 */
export const DEFAULT_PASSWORD_RESET_HTML = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  <p>Olá {{userName}},</p>
  <p>Recebemos um pedido para redefinir a palavra-passe da sua conta no <strong>{{appName}}</strong>.</p>
  <p><a href="{{resetUrl}}" style="color: #6366f1;">Redefinir palavra-passe</a></p>
  <p style="font-size: 12px; color: #6b7280;">Se não foi você, ignore este email. O link expira em breve.</p>
  <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">{{resetUrl}}</p>
</body>
</html>`;

export function escapeHtmlForEmailPlaceholder(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeOneLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim().slice(0, 300);
}

function fillHtmlPlaceholders(tpl: string, vars: { resetUrl: string; appName: string; userName: string }): string {
  const safeUrl = escapeHtmlForEmailPlaceholder(vars.resetUrl);
  const safeApp = escapeHtmlForEmailPlaceholder(vars.appName);
  const safeUser = escapeHtmlForEmailPlaceholder(vars.userName);
  return tpl
    .split("{{resetUrl}}")
    .join(safeUrl)
    .split("{{resetUrlText}}")
    .join(safeUrl)
    .split("{{appName}}")
    .join(safeApp)
    .split("{{userName}}")
    .join(safeUser);
}

function fillSubjectPlaceholders(tpl: string, vars: { resetUrl: string; appName: string; userName: string }): string {
  return tpl
    .split("{{resetUrl}}")
    .join(vars.resetUrl)
    .split("{{resetUrlText}}")
    .join(vars.resetUrl)
    .split("{{appName}}")
    .join(vars.appName)
    .split("{{userName}}")
    .join(vars.userName);
}

/** Dados de exemplo para pré-visualização no painel (não são URLs reais). */
export const PASSWORD_RESET_PREVIEW_SAMPLE = {
  resetUrl: "https://app.exemplo.com/login/reset?token=exemplo-token-seguro",
  userName: "Maria Silva",
} as const;

export function buildPasswordResetEmailContent(
  subjectTpl: string,
  htmlTpl: string,
  vars: { resetUrl: string; appName: string; userName: string },
): { subject: string; html: string } {
  const html = fillHtmlPlaceholders(htmlTpl, vars);
  const subject = sanitizeOneLine(fillSubjectPlaceholders(subjectTpl, vars));
  return { subject, html };
}
