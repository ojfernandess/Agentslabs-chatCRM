import { Resend } from "resend";
import type { ResendEmailConfig } from "./resendEmailSettings.js";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendPasswordResetEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  resetUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const href = escapeAttr(resetUrl);
  const textUrl = escapeAttr(resetUrl);
  const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  <p>Recebemos um pedido para redefinir a palavra-passe da sua conta no <strong>OpenNexo CRM</strong>.</p>
  <p><a href="${href}" style="color: #6366f1;">Redefinir palavra-passe</a></p>
  <p style="font-size: 12px; color: #6b7280;">Se não foi você, ignore este email. O link expira em breve.</p>
  <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">${textUrl}</p>
</body>
</html>`;

  const { data, error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [toEmail],
    subject: "OpenNexo CRM — recuperação de palavra-passe",
    html,
  });

  if (error) {
    return { ok: false, error: typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "resend_error" };
  }
  if (!data?.id) {
    return { ok: false, error: "no_message_id" };
  }
  return { ok: true };
}
