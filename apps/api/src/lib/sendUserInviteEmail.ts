import { Resend } from "resend";
import { buildUserInviteEmailContent } from "@openconduit/shared";
import type { ResendEmailConfig } from "./resendEmailSettings.js";
import { resolveSystemLogoUrl, resolveUserInviteTemplates } from "./resendEmailSettings.js";

export async function sendUserInviteEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  inviteUrl: string,
  organizationName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { subjectTpl, htmlTpl } = resolveUserInviteTemplates(cfg);
  const vars = {
    inviteUrl,
    appName: cfg.fromName,
    logoUrl: resolveSystemLogoUrl(cfg),
    userName: toEmail.split("@")[0] ?? "—",
    organizationName: organizationName.trim() || "—",
  };
  const { subject, html } = buildUserInviteEmailContent(subjectTpl, htmlTpl, vars);

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
