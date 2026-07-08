import nodemailer from "nodemailer";
import type { InboxEmailSmtpCredentials } from "./inboxEmailConfig.js";

function transportOptions(creds: InboxEmailSmtpCredentials) {
  const port = creds.smtpPort || 587;
  return {
    host: creds.smtpHost,
    port,
    secure: port === 465,
    auth: {
      user: creds.smtpUser,
      pass: creds.smtpPassword,
    },
    ...(port === 587 ? { requireTLS: true } : {}),
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 12_000,
  };
}

export async function testInboxSmtpConnection(
  creds: InboxEmailSmtpCredentials,
): Promise<{ connected: boolean; error?: string }> {
  const transporter = nodemailer.createTransport(transportOptions(creds));
  try {
    await transporter.verify();
    return { connected: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { connected: false, error: message.slice(0, 240) };
  } finally {
    transporter.close();
  }
}

export async function sendInboxSmtpEmail(options: {
  creds: InboxEmailSmtpCredentials;
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}): Promise<{ messageId: string | null }> {
  const transporter = nodemailer.createTransport(transportOptions(options.creds));
  try {
    const info = await transporter.sendMail({
      from: options.creds.fromAddress,
      to: options.to,
      subject: options.subject,
      text: options.text,
      replyTo: options.replyTo?.trim() || options.creds.fromAddress,
    });
    return { messageId: typeof info.messageId === "string" ? info.messageId : null };
  } finally {
    transporter.close();
  }
}
