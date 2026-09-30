import { Resend } from "resend";
import { buildWhatsappBillableAlertEmailContent } from "@openconduit/shared";
import type { ResendEmailConfig } from "./resendEmailSettings.js";
import { resolveSystemLogoUrl, resolveWhatsappBillableAlertTemplates } from "./resendEmailSettings.js";

export async function sendWhatsappBillableAlertEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  vars: {
    organizationName: string;
    billableCount: number;
    monthKey: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { subjectTpl, htmlTpl } = resolveWhatsappBillableAlertTemplates(cfg);
  const { subject, html } = buildWhatsappBillableAlertEmailContent(subjectTpl, htmlTpl, {
    appName: cfg.fromName,
    logoUrl: resolveSystemLogoUrl(cfg),
    organizationName: vars.organizationName,
    billableCount: String(vars.billableCount),
    monthKey: vars.monthKey,
  });

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
