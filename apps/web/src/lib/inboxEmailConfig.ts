export const MASKED_EMAIL_SECRET = "••••••••";

export type EmailProviderPreset = "custom" | "gmail" | "outlook";

export type InboxEmailConfigFields = {
  emailFromAddress?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  emailSmtpPassword?: string;
  emailImapHost?: string;
  emailImapPort?: number;
};

const PROVIDER_PRESETS: Record<
  Exclude<EmailProviderPreset, "custom">,
  Pick<InboxEmailConfigFields, "emailSmtpHost" | "emailSmtpPort" | "emailImapHost" | "emailImapPort">
> = {
  gmail: {
    emailSmtpHost: "smtp.gmail.com",
    emailSmtpPort: 587,
    emailImapHost: "imap.gmail.com",
    emailImapPort: 993,
  },
  outlook: {
    emailSmtpHost: "smtp.office365.com",
    emailSmtpPort: 587,
    emailImapHost: "outlook.office365.com",
    emailImapPort: 993,
  },
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

export function detectEmailProviderPreset(fields: InboxEmailConfigFields): EmailProviderPreset {
  const smtp = fields.emailSmtpHost?.toLowerCase();
  const imap = fields.emailImapHost?.toLowerCase();
  if (smtp === PROVIDER_PRESETS.gmail.emailSmtpHost && imap === PROVIDER_PRESETS.gmail.emailImapHost) {
    return "gmail";
  }
  if (
    (smtp === PROVIDER_PRESETS.outlook.emailSmtpHost || smtp === "smtp-mail.outlook.com") &&
    (imap === PROVIDER_PRESETS.outlook.emailImapHost || imap === "imap-mail.outlook.com")
  ) {
    return "outlook";
  }
  return "custom";
}

export function emailProviderPresetFields(preset: EmailProviderPreset): Partial<InboxEmailConfigFields> {
  if (preset === "custom") return {};
  return { ...PROVIDER_PRESETS[preset] };
}

export function isInboxEmailConfigured(fields: InboxEmailConfigFields): boolean {
  if (!fields.emailFromAddress?.trim()) return false;
  if (!fields.emailSmtpHost?.trim()) return false;
  if (!fields.emailSmtpUser?.trim()) return false;
  return Boolean(fields.emailSmtpPassword?.trim());
}

export function buildInboxEmailChannelConfig(
  cfg: unknown,
  patch: InboxEmailConfigFields,
): Record<string, unknown> {
  const base = { ...(asRecord(cfg) ?? {}) };

  const from = patch.emailFromAddress?.trim();
  if (from) base.emailFromAddress = from;
  else delete base.emailFromAddress;

  const smtpHost = patch.emailSmtpHost?.trim();
  if (smtpHost) base.emailSmtpHost = smtpHost;
  else delete base.emailSmtpHost;

  if (patch.emailSmtpPort != null && patch.emailSmtpPort > 0) base.emailSmtpPort = patch.emailSmtpPort;
  else delete base.emailSmtpPort;

  const smtpUser = patch.emailSmtpUser?.trim();
  if (smtpUser) base.emailSmtpUser = smtpUser;
  else delete base.emailSmtpUser;

  const smtpPassword = patch.emailSmtpPassword?.trim();
  if (smtpPassword && smtpPassword !== MASKED_EMAIL_SECRET) {
    base.emailSmtpPassword = smtpPassword;
  }

  const imapHost = patch.emailImapHost?.trim();
  if (imapHost) base.emailImapHost = imapHost;
  else delete base.emailImapHost;

  if (patch.emailImapPort != null && patch.emailImapPort > 0) base.emailImapPort = patch.emailImapPort;
  else delete base.emailImapPort;

  return base;
}

export function emailInboundJsonExample(fromAddress?: string): string {
  return JSON.stringify(
    {
      participantId: "cliente@exemplo.com",
      participantName: "Cliente",
      email: fromAddress?.trim() || "cliente@exemplo.com",
      body: "Olá, gostaria de mais informações.",
      type: "TEXT",
    },
    null,
    2,
  );
}
