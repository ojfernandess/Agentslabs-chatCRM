import type { InboxChannelType } from "@prisma/client";
import type { ChannelNativeConfig } from "./channelNativeTypes.js";

export const MASKED_EMAIL_SECRET = "••••••••";

export type InboxEmailConfigFields = {
  emailFromAddress?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  emailSmtpPassword?: string;
  emailImapHost?: string;
  emailImapPort?: number;
};

export type InboxEmailSmtpCredentials = {
  fromAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
};

function asRecord(cfg: unknown): Record<string, unknown> | null {
  return cfg !== null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function port(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function isMaskedSecret(v: string): boolean {
  return v === MASKED_EMAIL_SECRET;
}

export function parseInboxEmailFromChannelConfig(cfg: unknown): InboxEmailConfigFields {
  const c = asRecord(cfg);
  if (!c) return {};
  return {
    emailFromAddress: str(c.emailFromAddress),
    emailSmtpHost: str(c.emailSmtpHost),
    emailSmtpPort: port(c.emailSmtpPort),
    emailSmtpUser: str(c.emailSmtpUser),
    emailSmtpPassword: str(c.emailSmtpPassword),
    emailImapHost: str(c.emailImapHost),
    emailImapPort: port(c.emailImapPort),
  };
}

export function isInboxEmailConfiguredFromChannelConfig(cfg: unknown): boolean {
  const parsed = parseInboxEmailFromChannelConfig(cfg);
  if (!parsed.emailFromAddress || !parsed.emailSmtpHost || !parsed.emailSmtpUser) return false;
  return Boolean(parsed.emailSmtpPassword?.trim());
}

export function normalizeEmailInboxChannelConfig(existing: unknown, incoming: unknown): Record<string, unknown> {
  const base = { ...(asRecord(existing) ?? {}) };
  const patch = asRecord(incoming);
  if (!patch) return base;

  const from = str(patch.emailFromAddress);
  if (from) base.emailFromAddress = from;
  else delete base.emailFromAddress;

  const smtpHost = str(patch.emailSmtpHost);
  if (smtpHost) base.emailSmtpHost = smtpHost;
  else delete base.emailSmtpHost;

  const smtpPort = port(patch.emailSmtpPort);
  if (smtpPort != null) base.emailSmtpPort = smtpPort;
  else delete base.emailSmtpPort;

  const smtpUser = str(patch.emailSmtpUser);
  if (smtpUser) base.emailSmtpUser = smtpUser;
  else delete base.emailSmtpUser;

  const smtpPassword = str(patch.emailSmtpPassword);
  if (smtpPassword && !isMaskedSecret(smtpPassword)) {
    base.emailSmtpPassword = smtpPassword;
  }

  const imapHost = str(patch.emailImapHost);
  if (imapHost) base.emailImapHost = imapHost;
  else delete base.emailImapHost;

  const imapPort = port(patch.emailImapPort);
  if (imapPort != null) base.emailImapPort = imapPort;
  else delete base.emailImapPort;

  return base;
}

export function resolveInboxEmailSmtpCredentials(cfg: unknown): InboxEmailSmtpCredentials | null {
  const parsed = parseInboxEmailFromChannelConfig(cfg);
  const fromAddress = parsed.emailFromAddress?.trim();
  const smtpHost = parsed.emailSmtpHost?.trim();
  const smtpUser = parsed.emailSmtpUser?.trim();
  const smtpPassword = parsed.emailSmtpPassword?.trim();
  if (!fromAddress || !smtpHost || !smtpUser || !smtpPassword || isMaskedSecret(smtpPassword)) {
    return null;
  }
  return {
    fromAddress,
    smtpHost,
    smtpPort: parsed.emailSmtpPort ?? 587,
    smtpUser,
    smtpPassword,
  };
}

export function maskEmailChannelConfigForClient(cfg: unknown): unknown {
  const c = asRecord(cfg);
  if (!c) return cfg;
  const out = { ...c };
  if (
    typeof out.emailSmtpPassword === "string" &&
    out.emailSmtpPassword &&
    !isMaskedSecret(out.emailSmtpPassword)
  ) {
    out.emailSmtpPassword = MASKED_EMAIL_SECRET;
  }
  return out;
}

export function contactEmailForInboxChannel(
  contact: { email?: string | null; phone: string },
  channelType: InboxChannelType,
): string | null {
  const direct = contact.email?.trim();
  if (direct && direct.includes("@")) return direct;
  if (channelType !== "EMAIL") return null;
  const prefix = "oc|EMAIL|";
  if (!contact.phone.startsWith(prefix)) return null;
  const participant = contact.phone.slice(prefix.length).trim();
  return participant.includes("@") ? participant : null;
}

export function channelNativeConfigFromUnknown(cfg: unknown): ChannelNativeConfig | null {
  const c = asRecord(cfg);
  return c ? (c as ChannelNativeConfig) : null;
}

export function defaultEmailSubject(inboxName: string, contactName: string, isReply: boolean): string {
  const base = `${inboxName.trim() || "OpenNexo CRM"} — ${contactName.trim() || "Cliente"}`;
  return isReply ? `Re: ${base}` : base;
}
