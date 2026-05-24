import { prisma } from "../db.js";
import {
  DEFAULT_PASSWORD_RESET_HTML,
  DEFAULT_PASSWORD_RESET_SUBJECT,
  DEFAULT_USER_INVITE_HTML,
  DEFAULT_USER_INVITE_SUBJECT,
} from "@openconduit/shared";
import { getWebAppPublicOrigin } from "../config.js";

/** Chave em `platform_settings` — configurável no painel super admin. */
export const RESEND_EMAIL_PLATFORM_KEY = "resend_email";

export type ResendEmailConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  /** URL absoluta da logo nos emails (opcional; omissão = logo do painel web). */
  systemLogoUrl?: string | null;
  passwordResetSubject?: string | null;
  passwordResetHtmlTemplate?: string | null;
  userInviteSubject?: string | null;
  userInviteHtmlTemplate?: string | null;
};

export { DEFAULT_PASSWORD_RESET_HTML, DEFAULT_PASSWORD_RESET_SUBJECT };
export { DEFAULT_USER_INVITE_HTML, DEFAULT_USER_INVITE_SUBJECT };

export function resolveSystemLogoUrl(cfg: ResendEmailConfig): string {
  const custom = cfg.systemLogoUrl?.trim();
  if (custom) return custom;
  return `${getWebAppPublicOrigin()}/logo.svg`;
}

export function parseResendEmailValue(raw: unknown): ResendEmailConfig | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const apiKey = String(o.apiKey ?? "").trim();
  const fromEmail = String(o.fromEmail ?? "").trim();
  const fromName = String(o.fromName ?? "OpenNexo CRM").trim() || "OpenNexo CRM";
  if (!apiKey || !fromEmail) return null;
  const systemLogoUrl =
    typeof o.systemLogoUrl === "string" && o.systemLogoUrl.trim() ? o.systemLogoUrl.trim().slice(0, 2000) : null;
  const passwordResetSubject =
    typeof o.passwordResetSubject === "string" && o.passwordResetSubject.trim()
      ? o.passwordResetSubject.trim().slice(0, 200)
      : null;
  const passwordResetHtmlTemplate =
    typeof o.passwordResetHtmlTemplate === "string" && o.passwordResetHtmlTemplate.trim()
      ? o.passwordResetHtmlTemplate.trim().slice(0, 100_000)
      : null;
  const userInviteSubject =
    typeof o.userInviteSubject === "string" && o.userInviteSubject.trim()
      ? o.userInviteSubject.trim().slice(0, 200)
      : null;
  const userInviteHtmlTemplate =
    typeof o.userInviteHtmlTemplate === "string" && o.userInviteHtmlTemplate.trim()
      ? o.userInviteHtmlTemplate.trim().slice(0, 100_000)
      : null;
  return {
    apiKey,
    fromEmail,
    fromName,
    systemLogoUrl,
    passwordResetSubject,
    passwordResetHtmlTemplate,
    userInviteSubject,
    userInviteHtmlTemplate,
  };
}

export function resolvePasswordResetTemplates(cfg: ResendEmailConfig): { subjectTpl: string; htmlTpl: string } {
  return {
    subjectTpl: cfg.passwordResetSubject?.trim() || DEFAULT_PASSWORD_RESET_SUBJECT,
    htmlTpl: cfg.passwordResetHtmlTemplate?.trim() || DEFAULT_PASSWORD_RESET_HTML,
  };
}

export function resolveUserInviteTemplates(cfg: ResendEmailConfig): { subjectTpl: string; htmlTpl: string } {
  return {
    subjectTpl: cfg.userInviteSubject?.trim() || DEFAULT_USER_INVITE_SUBJECT,
    htmlTpl: cfg.userInviteHtmlTemplate?.trim() || DEFAULT_USER_INVITE_HTML,
  };
}

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

export function getUserInviteTemplatesForEditor(raw: unknown): { subject: string; html: string } {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const subject =
    typeof o.userInviteSubject === "string" && o.userInviteSubject.trim()
      ? o.userInviteSubject.trim().slice(0, 200)
      : DEFAULT_USER_INVITE_SUBJECT;
  const html =
    typeof o.userInviteHtmlTemplate === "string" && o.userInviteHtmlTemplate.trim()
      ? o.userInviteHtmlTemplate.trim().slice(0, 100_000)
      : DEFAULT_USER_INVITE_HTML;
  return { subject, html };
}

export async function getResendEmailConfigFromDb(): Promise<ResendEmailConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RESEND_EMAIL_PLATFORM_KEY },
  });
  return parseResendEmailValue(row?.value);
}
