import { prisma } from "../db.js";
import { InboxChannelType } from "@prisma/client";
import { encrypt } from "./encryption.js";
import { generateWhatsappWebhookVerifyToken } from "./whatsappWebhookVerify.js";
import { webhookUrlForInbox } from "../config.js";

export const MASKED_WHATSAPP_SECRET = "••••••••";

export type InboxWhatsappProvider =
  | "meta"
  | "360dialog"
  | "twilio"
  | "evolution"
  | "evolution_go";

export type InboxWhatsappConfigFields = {
  whatsappProvider?: InboxWhatsappProvider;
  whatsappPhoneNumberId?: string;
  whatsappApiKey?: string;
  whatsappWebhookSecret?: string;
  whatsappWebhookVerifyToken?: string;
  evolutionApiBaseUrl?: string;
  whatsappDisplayPhone?: string;
  whatsappBusinessAccountId?: string;
};

export type InboxWhatsappCredentialSource = {
  whatsappProvider: string;
  whatsappPhoneNumberId: string | null;
  whatsappApiKey: string | null;
  whatsappWebhookSecret: string | null;
  whatsappWebhookVerifyToken: string | null;
  evolutionApiBaseUrl: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function isMetaCloudWhatsappProvider(provider: string | null | undefined): boolean {
  return provider === "meta" || provider === "360dialog";
}

export function parseInboxWhatsappFromChannelConfig(cfg: unknown): InboxWhatsappConfigFields {
  const c = asRecord(cfg);
  if (!c) return {};
  const provider = str(c.whatsappProvider);
  return {
    whatsappProvider: provider as InboxWhatsappProvider | undefined,
    whatsappPhoneNumberId: str(c.whatsappPhoneNumberId),
    whatsappApiKey: str(c.whatsappApiKey),
    whatsappWebhookSecret: str(c.whatsappWebhookSecret),
    whatsappWebhookVerifyToken: str(c.whatsappWebhookVerifyToken),
    evolutionApiBaseUrl: str(c.evolutionApiBaseUrl),
    whatsappDisplayPhone: str(c.whatsappDisplayPhone),
    whatsappBusinessAccountId: str(c.whatsappBusinessAccountId),
  };
}

function hasWhatsappApiKeyStored(fields: InboxWhatsappConfigFields): boolean {
  const key = fields.whatsappApiKey?.trim() ?? "";
  if (!key) return false;
  if (key === MASKED_WHATSAPP_SECRET) return true;
  return true;
}

export function isInboxWhatsappConfigured(fields: InboxWhatsappConfigFields): boolean {
  const p = fields.whatsappProvider;
  if (!p) return false;
  const hasInstance = Boolean(fields.whatsappPhoneNumberId?.trim());
  if (isMetaCloudWhatsappProvider(p) || p === "twilio") {
    return hasInstance && hasWhatsappApiKeyStored(fields);
  }
  return hasInstance;
}

/** Avalia credenciais gravadas (inclui chave encriptada no JSON). */
export function isInboxWhatsappConfiguredFromChannelConfig(cfg: unknown): boolean {
  return isInboxWhatsappConfigured(parseInboxWhatsappFromChannelConfig(cfg));
}

function isMaskedSecret(v: string | undefined): boolean {
  return v === MASKED_WHATSAPP_SECRET;
}

function encryptIfPlain(value: string | undefined, existingEncrypted: string | undefined): string | undefined {
  if (!value || isMaskedSecret(value)) return existingEncrypted;
  if (value.includes(":") && value.length > 32) {
    return value;
  }
  return encrypt(value);
}

/** Mascara segredos em `channelConfig` antes de enviar ao cliente. */
export function maskWhatsappChannelConfigForClient(cfg: unknown): unknown {
  const c = asRecord(cfg);
  if (!c) return cfg;
  const out = { ...c };
  if (typeof out.whatsappApiKey === "string" && out.whatsappApiKey && !isMaskedSecret(out.whatsappApiKey)) {
    out.whatsappApiKey = MASKED_WHATSAPP_SECRET;
  }
  if (
    typeof out.whatsappWebhookSecret === "string" &&
    out.whatsappWebhookSecret &&
    !isMaskedSecret(out.whatsappWebhookSecret)
  ) {
    out.whatsappWebhookSecret = MASKED_WHATSAPP_SECRET;
  }
  return out;
}

export function maskInboxRowChannelConfig<T extends { channelConfig?: unknown }>(row: T): T {
  if (row.channelConfig == null) return row;
  return { ...row, channelConfig: maskWhatsappChannelConfigForClient(row.channelConfig) };
}

/** Credenciais da caixa; se a caixa não tiver provider, usa Settings (legado). */
export async function resolveInboxWhatsappCredentials(
  organizationId: string,
  inbox: { channelConfig: unknown },
): Promise<InboxWhatsappCredentialSource | null> {
  const parsed = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  if (parsed.whatsappProvider) {
    return {
      whatsappProvider: parsed.whatsappProvider,
      whatsappPhoneNumberId: parsed.whatsappPhoneNumberId ?? null,
      whatsappApiKey: parsed.whatsappApiKey ?? null,
      whatsappWebhookSecret: parsed.whatsappWebhookSecret ?? null,
      whatsappWebhookVerifyToken: parsed.whatsappWebhookVerifyToken ?? null,
      evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
    };
  }

  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappProvider) return null;
  return {
    whatsappProvider: settings.whatsappProvider,
    whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
    whatsappApiKey: settings.whatsappApiKey,
    whatsappWebhookSecret: settings.whatsappWebhookSecret,
    whatsappWebhookVerifyToken: settings.whatsappWebhookVerifyToken ?? null,
    evolutionApiBaseUrl: settings.evolutionApiBaseUrl,
  };
}

export async function findWhatsappInboxByProvider(
  organizationId: string,
  provider: string,
  excludeInboxId?: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, name: true, channelConfig: true },
  });
  for (const row of rows) {
    if (excludeInboxId && row.id === excludeInboxId) continue;
    const p = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappProvider;
    if (p === provider) return { id: row.id, name: row.name };
  }
  return null;
}

/** Localiza organização (e caixa) pelo phone_number_id Meta em qualquer caixa ou Settings legado. */
export async function findOrganizationByMetaPhoneNumberId(
  phoneNumberId: string,
): Promise<{ organizationId: string; inboxId?: string } | null> {
  const needle = phoneNumberId.trim();
  if (!needle) return null;

  const rows = await prisma.inbox.findMany({
    where: { channelType: InboxChannelType.WHATSAPP },
    select: { id: true, organizationId: true, channelConfig: true },
  });
  for (const row of rows) {
    const id = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappPhoneNumberId?.trim();
    if (id === needle) return { organizationId: row.organizationId, inboxId: row.id };
  }

  const settings = await prisma.settings.findFirst({
    where: { whatsappPhoneNumberId: needle },
    select: { organizationId: true },
  });
  if (settings) return { organizationId: settings.organizationId };
  return null;
}

export async function findWhatsappInboxByPhoneNumberId(
  organizationId: string,
  phoneNumberId: string,
): Promise<{ id: string; channelConfig: unknown } | null> {
  const needle = phoneNumberId.trim();
  if (!needle) return null;

  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, channelConfig: true },
  });
  for (const row of rows) {
    const id = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappPhoneNumberId?.trim();
    if (id === needle) return row;
  }

  const settings = await prisma.settings.findFirst({
    where: { organizationId, whatsappPhoneNumberId: needle },
    select: { organizationId: true },
  });
  if (!settings) return null;

  const fallback = await prisma.inbox.findFirst({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, channelConfig: true },
  });
  return fallback;
}

export async function assertUniqueWhatsappProviderInOrg(
  organizationId: string,
  provider: string,
  excludeInboxId?: string,
): Promise<{ conflict: true; existingInboxName: string } | { conflict: false }> {
  const existing = await findWhatsappInboxByProvider(organizationId, provider, excludeInboxId);
  if (existing) {
    return { conflict: true, existingInboxName: existing.name };
  }
  return { conflict: false };
}

export type PrepareWhatsappChannelConfigOptions = {
  existingConfig: unknown;
  incoming: Record<string, unknown>;
  /** Gera token Meta se provider cloud e ainda não existir. */
  ensureMetaVerifyToken?: boolean;
};

/** Normaliza e encripta credenciais WhatsApp em `channelConfig` antes de persistir. */
export function prepareWhatsappChannelConfigForSave(
  opts: PrepareWhatsappChannelConfigOptions,
): Record<string, unknown> {
  const base = asRecord(opts.existingConfig) ?? {};
  const out: Record<string, unknown> = { ...base };
  const inc = opts.incoming;
  const existing = parseInboxWhatsappFromChannelConfig(base);

  const provider =
    typeof inc.whatsappProvider === "string" && inc.whatsappProvider.trim()
      ? inc.whatsappProvider.trim()
      : existing.whatsappProvider;
  if (provider) out.whatsappProvider = provider;
  else delete out.whatsappProvider;

  if ("whatsappPhoneNumberId" in inc) {
    const v = str(inc.whatsappPhoneNumberId);
    if (v) out.whatsappPhoneNumberId = v;
    else delete out.whatsappPhoneNumberId;
  }

  if ("whatsappDisplayPhone" in inc) {
    const v = str(inc.whatsappDisplayPhone);
    if (v) out.whatsappDisplayPhone = v;
    else delete out.whatsappDisplayPhone;
  }
  if ("whatsappBusinessAccountId" in inc) {
    const v = str(inc.whatsappBusinessAccountId);
    if (v) out.whatsappBusinessAccountId = v;
    else delete out.whatsappBusinessAccountId;
  }

  if ("evolutionApiBaseUrl" in inc) {
    const v = str(inc.evolutionApiBaseUrl);
    if (v) out.evolutionApiBaseUrl = v;
    else delete out.evolutionApiBaseUrl;
  }

  if ("whatsappApiKey" in inc) {
    const plain = str(inc.whatsappApiKey);
    const enc = encryptIfPlain(plain, existing.whatsappApiKey);
    if (enc) out.whatsappApiKey = enc;
    else if (plain === "") delete out.whatsappApiKey;
  }

  if ("whatsappWebhookSecret" in inc) {
    const plain = str(inc.whatsappWebhookSecret);
    const enc = encryptIfPlain(plain, existing.whatsappWebhookSecret);
    if (enc) out.whatsappWebhookSecret = enc;
    else if (plain === "") delete out.whatsappWebhookSecret;
  }

  if ("whatsappWebhookVerifyToken" in inc) {
    const v = str(inc.whatsappWebhookVerifyToken);
    if (v) out.whatsappWebhookVerifyToken = v;
    else delete out.whatsappWebhookVerifyToken;
  }

  const effectiveProvider = str(out.whatsappProvider) ?? provider;
  if (
    opts.ensureMetaVerifyToken &&
    isMetaCloudWhatsappProvider(effectiveProvider) &&
    !str(out.whatsappWebhookVerifyToken)
  ) {
    out.whatsappWebhookVerifyToken = generateWhatsappWebhookVerifyToken();
  }

  return out;
}

export function whatsappWebhookMetaFromConfig(
  cfg: unknown,
  organizationId: string,
  inboxId: string,
): { webhookUrl: string; verifyToken: string | null } {
  const parsed = parseInboxWhatsappFromChannelConfig(cfg);
  return {
    webhookUrl: webhookUrlForInbox(organizationId, inboxId),
    verifyToken: parsed.whatsappWebhookVerifyToken ?? null,
  };
}
