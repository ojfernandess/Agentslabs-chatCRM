import { Resend } from "resend";
import { getResendEmailConfigFromDb, type ResendEmailConfig } from "./resendEmailSettings.js";

export type ResendAttachment = {
  filename: string;
  content: Buffer;
};

async function sendViaResend(
  cfg: ResendEmailConfig,
  toEmail: string,
  subject: string,
  html: string,
  attachments?: ResendAttachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { data, error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [toEmail],
    subject,
    html,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
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
  if (!data?.id) return { ok: false, error: "no_message_id" };
  return { ok: true };
}

export async function sendResendEmail(options: {
  toEmail: string;
  subject: string;
  html: string;
  attachments?: ResendAttachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await getResendEmailConfigFromDb();
  if (!cfg?.apiKey || !cfg.fromEmail) return { ok: false, error: "resend_not_configured" };
  return sendViaResend(cfg, options.toEmail, options.subject, options.html, options.attachments);
}
