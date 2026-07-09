import nodemailer from "nodemailer";
import type { InboxEmailSmtpCredentials } from "./inboxEmailConfig.js";
import type { EmailSmtpAttachment } from "./emailMediaAttachment.js";

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
): Promise<{ connected: boolean; error?: string; sentTo?: string }> {
  const transporter = nodemailer.createTransport(transportOptions(creds));
  try {
    await transporter.verify();
    const sentTo = creds.fromAddress.trim();
    await transporter.sendMail({
      from: creds.fromAddress,
      to: sentTo,
      subject: "OpenNexo CRM — Teste SMTP",
      text: [
        "Este e-mail confirma que o SMTP da sua caixa está configurado corretamente.",
        "",
        `Remetente: ${creds.fromAddress}`,
        `Servidor: ${creds.smtpHost}:${creds.smtpPort || 587}`,
        `Enviado em: ${new Date().toISOString()}`,
      ].join("\n"),
    });
    return { connected: true, sentTo };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { connected: false, error: message.slice(0, 240) };
  } finally {
    transporter.close();
  }
}

function normalizeRecipientField(value: string | string[] | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const list = value.map((v) => v.trim()).filter(Boolean);
    return list.length > 0 ? list.join(", ") : undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function sendInboxSmtpEmail(options: {
  creds: InboxEmailSmtpCredentials;
  to: string | string[];
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  subject: string;
  text: string;
  replyTo?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: EmailSmtpAttachment[];
}): Promise<{ messageId: string | null }> {
  const to = normalizeRecipientField(options.to);
  if (!to) {
    throw new Error("At least one To recipient is required");
  }
  const cc = normalizeRecipientField(options.cc);
  const bcc = normalizeRecipientField(options.bcc);

  const transporter = nodemailer.createTransport(transportOptions(options.creds));
  try {
    const info = await transporter.sendMail({
      from: options.creds.fromAddress,
      to,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      subject: options.subject,
      text: options.text,
      replyTo: options.replyTo?.trim() || options.creds.fromAddress,
      ...(options.inReplyTo?.trim() ? { inReplyTo: options.inReplyTo.trim() } : {}),
      ...(options.references?.trim() ? { references: options.references.trim() } : {}),
      ...(options.attachments && options.attachments.length > 0
        ? {
            attachments: options.attachments.map((att) => ({
              filename: att.filename,
              content: att.content,
              contentType: att.contentType,
            })),
          }
        : {}),
    });
    return { messageId: typeof info.messageId === "string" ? info.messageId : null };
  } finally {
    transporter.close();
  }
}
