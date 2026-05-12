import { prisma } from "../db.js";

/** Chave em `platform_settings` — configurável no painel super admin. */
export const RESEND_EMAIL_PLATFORM_KEY = "resend_email";

export type ResendEmailConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
};

export function parseResendEmailValue(raw: unknown): ResendEmailConfig | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const apiKey = String(o.apiKey ?? "").trim();
  const fromEmail = String(o.fromEmail ?? "").trim();
  const fromName = String(o.fromName ?? "OpenNexo CRM").trim() || "OpenNexo CRM";
  if (!apiKey || !fromEmail) return null;
  return { apiKey, fromEmail, fromName };
}

export async function getResendEmailConfigFromDb(): Promise<ResendEmailConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: RESEND_EMAIL_PLATFORM_KEY },
  });
  return parseResendEmailValue(row?.value);
}
