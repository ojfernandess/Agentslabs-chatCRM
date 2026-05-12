import { Resend } from "resend";
import type { ResendEmailConfig } from "./resendEmailSettings.js";
import { resolvePasswordResetTemplates } from "./resendEmailSettings.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeOneLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim().slice(0, 300);
}

function fillPlaceholders(tpl: string, vars: { resetUrl: string; appName: string; userName: string }): string {
  const safeUrl = escapeHtml(vars.resetUrl);
  const safeApp = escapeHtml(vars.appName);
  const safeUser = escapeHtml(vars.userName);
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

export async function sendPasswordResetEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  resetUrl: string,
  userName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { subjectTpl, htmlTpl } = resolvePasswordResetTemplates(cfg);
  const vars = { resetUrl, appName: cfg.fromName, userName: userName.trim() || "—" };
  const html = fillPlaceholders(htmlTpl, vars);
  const subject = sanitizeOneLine(
    subjectTpl
      .split("{{resetUrl}}")
      .join(resetUrl)
      .split("{{resetUrlText}}")
      .join(resetUrl)
      .split("{{appName}}")
      .join(cfg.fromName)
      .split("{{userName}}")
      .join(vars.userName),
  );

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
  if (!data?.id) {
    return { ok: false, error: "no_message_id" };
  }
  return { ok: true };
}
