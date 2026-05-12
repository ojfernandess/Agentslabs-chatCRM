import { Resend } from "resend";
import { buildPasswordResetEmailContent } from "@openconduit/shared";
import type { ResendEmailConfig } from "./resendEmailSettings.js";
import { resolvePasswordResetTemplates } from "./resendEmailSettings.js";

export async function sendPasswordResetEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  resetUrl: string,
  userName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { subjectTpl, htmlTpl } = resolvePasswordResetTemplates(cfg);
  const vars = { resetUrl, appName: cfg.fromName, userName: userName.trim() || "—" };
  const { subject, html } = buildPasswordResetEmailContent(subjectTpl, htmlTpl, vars);

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
