import { prisma } from "../db.js";
import {
  DEFAULT_PASSWORD_RESET_HTML,
  DEFAULT_PASSWORD_RESET_SUBJECT,
} from "@openconduit/shared";

/** Chave em `platform_settings` — configurável no painel super admin. */
export const RESEND_EMAIL_PLATFORM_KEY = "resend_email";

export type ResendEmailConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  passwordResetSubject?: string | null;
  passwordResetHtmlTemplate?: string | null;
};

export { DEFAULT_PASSWORD_RESET_HTML, DEFAULT_PASSWORD_RESET_SUBJECT };

export function parseResendEmailValue(raw: unknown): ResendEmailConfig | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const apiKey = String(o.apiKey ?? "").trim();
  const fromEmail = String(o.fromEmail ?? "").trim();
  const fromName = String(o.fromName ?? "OpenNexo CRM").trim() || "OpenNexo CRM";
  if (!apiKey || !fromEmail) return null;
  const passwordResetSubject =
    typeof o.passwordResetSubject === "string" && o.passwordResetSubject.trim()
      ? o.passwordResetSubject.trim().slice(0, 200)
      : null;
  const passwordResetHtmlTemplate =
    typeof o.passwordResetHtmlTemplate === "string" && o.passwordResetHtmlTemplate.trim()
      ? o.passwordResetHtmlTemplate.trim().slice(0, 100_000)
      : null;
  return { apiKey, fromEmail, fromName, passwordResetSubject, passwordResetHtmlTemplate };
}

/** Textos efectivos do email (usa personalizados ou omissão). */
export function resolvePasswordResetTemplates(cfg: ResendEmailConfig): { subjectTpl: string; htmlTpl: string } {
  return {
    subjectTpl: cfg.passwordResetSubject?.trim() || DEFAULT_PASSWORD_RESET_SUBJECT,
    htmlTpl: cfg.passwordResetHtmlTemplate?.trim() || DEFAULT_PASSWORD_RESET_HTML,
  };
}

/** Para o formulário super admin: lê JSON gravado e devolve strings já com omissão aplicada. */
export function getPasswordResetTemplatesForEditor(raw: unknown): { subject: string; html: string } {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const subject =
    typeof o.passwordResetSubject === "string" && o.passwordResetSubject.trim()
      ? o.passwordResetSubject.trim().slice(0, 200)
      : DEFAULT_PASSWORD_RESET_SUBJECT;
  const html =
    typeof o.passwordResetHtmlTemplate === "string" && o.passwordResetHtmlTemplate.trim()
      ? o.passwordResetHtmlTemplate.trim().slice(0, 100_000)
      : DEFAULT_PASSWORD_RESET_HTML;
  return { subject, html };
}

export async function getResendEmailConfigFromDb(): Promise<ResendEmailConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RESEND_EMAIL_PLATFORM_KEY },
  });
  return parseResendEmailValue(row?.value);
}
