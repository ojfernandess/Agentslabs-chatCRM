import { prisma } from "../db.js";
import {
  buildDefaultSystemLogoUrl,
  DEFAULT_BILLING_REMINDER_HTML,
  DEFAULT_BILLING_REMINDER_SUBJECT,
  DEFAULT_PASSWORD_RESET_HTML,
  DEFAULT_PASSWORD_RESET_SUBJECT,
  DEFAULT_PAYMENT_CONFIRMATION_HTML,
  DEFAULT_PAYMENT_CONFIRMATION_SUBJECT,
  DEFAULT_USER_INVITE_HTML,
  DEFAULT_USER_INVITE_SUBJECT,
  isPlaceholderSystemLogoUrl,
  normalizeSystemLogoUrl,
  SYSTEM_LOGO_PATH,
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
  billingReminderSubject?: string | null;
  billingReminderHtmlTemplate?: string | null;
  paymentConfirmationSubject?: string | null;
  paymentConfirmationHtmlTemplate?: string | null;
};

export { DEFAULT_PASSWORD_RESET_HTML, DEFAULT_PASSWORD_RESET_SUBJECT };
export { DEFAULT_USER_INVITE_HTML, DEFAULT_USER_INVITE_SUBJECT };
export { DEFAULT_BILLING_REMINDER_HTML, DEFAULT_BILLING_REMINDER_SUBJECT };
export { DEFAULT_PAYMENT_CONFIRMATION_HTML, DEFAULT_PAYMENT_CONFIRMATION_SUBJECT };

export const DEFAULT_SYSTEM_LOGO_PATH = SYSTEM_LOGO_PATH;

export { isPlaceholderSystemLogoUrl };

export function resolveSystemLogoUrlFromSetting(systemLogoUrl?: string | null): string {
  const origin = getWebAppPublicOrigin();
  const custom = systemLogoUrl?.trim();
  if (!custom) return buildDefaultSystemLogoUrl(origin);
  return normalizeSystemLogoUrl(custom, origin);
}

export function resolveSystemLogoUrl(cfg: Pick<ResendEmailConfig, "systemLogoUrl">): string {
  return resolveSystemLogoUrlFromSetting(cfg.systemLogoUrl);
}

export function parseResendEmailValue(raw: unknown): ResendEmailConfig | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const apiKey = String(o.apiKey ?? "").trim();
  const fromEmail = String(o.fromEmail ?? "").trim();
  const fromName = String(o.fromName ?? "OpenNexo CRM").trim() || "OpenNexo CRM";
  if (!apiKey || !fromEmail) return null;
  const rawLogo =
    typeof o.systemLogoUrl === "string" && o.systemLogoUrl.trim() ? o.systemLogoUrl.trim().slice(0, 2000) : null;
  const systemLogoUrl =
    rawLogo && !isPlaceholderSystemLogoUrl(rawLogo)
      ? normalizeSystemLogoUrl(rawLogo, getWebAppPublicOrigin())
      : null;
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
  const billingReminderSubject =
    typeof o.billingReminderSubject === "string" && o.billingReminderSubject.trim()
      ? o.billingReminderSubject.trim().slice(0, 200)
      : null;
  const billingReminderHtmlTemplate =
    typeof o.billingReminderHtmlTemplate === "string" && o.billingReminderHtmlTemplate.trim()
      ? o.billingReminderHtmlTemplate.trim().slice(0, 100_000)
      : null;
  const paymentConfirmationSubject =
    typeof o.paymentConfirmationSubject === "string" && o.paymentConfirmationSubject.trim()
      ? o.paymentConfirmationSubject.trim().slice(0, 200)
      : null;
  const paymentConfirmationHtmlTemplate =
    typeof o.paymentConfirmationHtmlTemplate === "string" && o.paymentConfirmationHtmlTemplate.trim()
      ? o.paymentConfirmationHtmlTemplate.trim().slice(0, 100_000)
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
    billingReminderSubject,
    billingReminderHtmlTemplate,
    paymentConfirmationSubject,
    paymentConfirmationHtmlTemplate,
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

export function resolveBillingReminderTemplates(cfg: ResendEmailConfig): { subjectTpl: string; htmlTpl: string } {
  return {
    subjectTpl: cfg.billingReminderSubject?.trim() || DEFAULT_BILLING_REMINDER_SUBJECT,
    htmlTpl: cfg.billingReminderHtmlTemplate?.trim() || DEFAULT_BILLING_REMINDER_HTML,
  };
}

export function resolvePaymentConfirmationTemplates(cfg: ResendEmailConfig): {
  subjectTpl: string;
  htmlTpl: string;
} {
  return {
    subjectTpl: cfg.paymentConfirmationSubject?.trim() || DEFAULT_PAYMENT_CONFIRMATION_SUBJECT,
    htmlTpl: cfg.paymentConfirmationHtmlTemplate?.trim() || DEFAULT_PAYMENT_CONFIRMATION_HTML,
  };
}

export function getBillingReminderTemplatesForEditor(raw: unknown): { subject: string; html: string } {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    subject:
      typeof o.billingReminderSubject === "string" && o.billingReminderSubject.trim()
        ? o.billingReminderSubject.trim().slice(0, 200)
        : DEFAULT_BILLING_REMINDER_SUBJECT,
    html:
      typeof o.billingReminderHtmlTemplate === "string" && o.billingReminderHtmlTemplate.trim()
        ? o.billingReminderHtmlTemplate.trim().slice(0, 100_000)
        : DEFAULT_BILLING_REMINDER_HTML,
  };
}

export function getPaymentConfirmationTemplatesForEditor(raw: unknown): { subject: string; html: string } {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    subject:
      typeof o.paymentConfirmationSubject === "string" && o.paymentConfirmationSubject.trim()
        ? o.paymentConfirmationSubject.trim().slice(0, 200)
        : DEFAULT_PAYMENT_CONFIRMATION_SUBJECT,
    html:
      typeof o.paymentConfirmationHtmlTemplate === "string" && o.paymentConfirmationHtmlTemplate.trim()
        ? o.paymentConfirmationHtmlTemplate.trim().slice(0, 100_000)
        : DEFAULT_PAYMENT_CONFIRMATION_HTML,
  };
}

export async function getResendEmailConfigFromDb(): Promise<ResendEmailConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RESEND_EMAIL_PLATFORM_KEY },
  });
  return parseResendEmailValue(row?.value);
}

/** Nome público do sistema (Super Admin → E-mail transacional → Nome do remetente). */
export async function getPlatformSystemName(): Promise<string> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RESEND_EMAIL_PLATFORM_KEY },
  });
  if (!row?.value || typeof row.value !== "object" || row.value === null) {
    return "OpenNexo CRM";
  }
  const fromName = String((row.value as Record<string, unknown>).fromName ?? "").trim();
  return fromName || "OpenNexo CRM";
}
