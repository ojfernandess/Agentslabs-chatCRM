import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getCachedOrganizationSettings } from "./requestLookupCache.js";
import { InboxChannelType } from "@prisma/client";
import { encrypt } from "./encryption.js";
import { generateWhatsappWebhookVerifyToken } from "./whatsappWebhookVerify.js";
import { webhookUrlForInbox } from "../config.js";
import { maskEmailChannelConfigForClient } from "./inboxEmailConfig.js";
import { maskTelegramChannelConfigForClient } from "./inboxTelegramConfig.js";

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

export type ResolveInboxWhatsappCredentialsInput = {
  channelConfig: unknown;
  channelType?: string | null;
  /** Coluna indexada `Inbox.whatsappPhoneNumberId` (pode existir sem JSON completo). */
  whatsappPhoneNumberId?: string | null;
  /** Caixa default pode herdar Settings legado; demais caixas WhatsApp não. */
  isDefault?: boolean;
};

/** Fallback Settings→inbox por phone_number_id só em org com uma única caixa WhatsApp. */
export function allowWhatsappSettingsPhoneInboxFallback(whatsappInboxCount: number): boolean {
  return whatsappInboxCount === 1;
}

/** Caixas WhatsApp dedicadas não devem herdar credenciais legadas de Settings (multi-inbox). */
export function shouldFallbackWhatsappCredentialsToSettings(
  inbox: ResolveInboxWhatsappCredentialsInput,
  parsed: InboxWhatsappConfigFields,
): boolean {
  if (parsed.whatsappProvider) return false;
  if (inbox.channelType !== InboxChannelType.WHATSAPP) return true;
  const hasDedicatedConfig =
    Boolean(inbox.whatsappPhoneNumberId?.trim()) ||
    Boolean(parsed.whatsappPhoneNumberId?.trim()) ||
    Boolean(parsed.whatsappApiKey?.trim()) ||
    Boolean(parsed.whatsappWebhookSecret?.trim()) ||
    Boolean(parsed.evolutionApiBaseUrl?.trim());
  if (hasDedicatedConfig) return false;
  // Multi-inbox: só a caixa default sem config própria pode usar Settings da org.
  if (inbox.isDefault === false) return false;
  return true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function isMetaCloudWhatsappProvider(provider: string | null | undefined): boolean {
  return provider === "meta" || provider === "360dialog";
}

/** Meta Cloud API pode ter várias caixas na mesma organização (um Phone Number ID por caixa). */
export function whatsappProviderAllowsMultipleInboxes(provider: string | null | undefined): boolean {
  return provider === "meta";
}

/** Valor indexado em `Inbox.whatsappPhoneNumberId` (derivado de `channelConfig`). */
export function inboxWhatsappPhoneNumberIdForColumn(channelConfig: unknown): string | null {
  const id = parseInboxWhatsappFromChannelConfig(channelConfig).whatsappPhoneNumberId?.trim();
  return id || null;
}

/** Mantém coluna indexada sincronizada quando `channelConfig` é gravado. */
export function withInboxWhatsappPhoneNumberIdColumn<T extends Prisma.InboxUpdateInput>(
  data: T,
): T {
  if (data.channelConfig === undefined) return data;
  const channelConfig = data.channelConfig;
  const phoneId =
    channelConfig == null ? null : inboxWhatsappPhoneNumberIdForColumn(channelConfig);
  return { ...data, whatsappPhoneNumberId: phoneId };
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
  const maskedWhatsapp = maskWhatsappChannelConfigForClient(row.channelConfig);
  const maskedEmail = maskEmailChannelConfigForClient(maskedWhatsapp);
  return { ...row, channelConfig: maskTelegramChannelConfigForClient(maskedEmail) };
}

/** Credenciais da caixa; fallback a Settings só para caixas legado sem config dedicada. */
export async function resolveInboxWhatsappCredentials(
  organizationId: string,
  inbox: ResolveInboxWhatsappCredentialsInput,
): Promise<InboxWhatsappCredentialSource | null> {
  const parsed = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  const phoneNumberId =
    parsed.whatsappPhoneNumberId?.trim() || inbox.whatsappPhoneNumberId?.trim() || null;

  if (parsed.whatsappProvider) {
    return {
      whatsappProvider: parsed.whatsappProvider,
      whatsappPhoneNumberId: phoneNumberId,
      whatsappApiKey: parsed.whatsappApiKey ?? null,
      whatsappWebhookSecret: parsed.whatsappWebhookSecret ?? null,
      whatsappWebhookVerifyToken: parsed.whatsappWebhookVerifyToken ?? null,
      evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
    };
  }

  if (!shouldFallbackWhatsappCredentialsToSettings(inbox, parsed)) {
    return null;
  }

  const settings = await getCachedOrganizationSettings(organizationId);
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

export async function findWhatsappInboxesByProvider(
  organizationId: string,
  provider: string,
  excludeInboxId?: string,
): Promise<{ id: string; name: string; channelConfig: unknown; whatsappPhoneNumberId: string | null }[]> {
  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, name: true, channelConfig: true, whatsappPhoneNumberId: true },
  });
  return rows.filter((row) => {
    if (excludeInboxId && row.id === excludeInboxId) return false;
    return parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappProvider === provider;
  });
}

export async function findWhatsappInboxByProvider(
  organizationId: string,
  provider: string,
  excludeInboxId?: string,
): Promise<{ id: string; name: string } | null> {
  const [first] = await findWhatsappInboxesByProvider(organizationId, provider, excludeInboxId);
  return first ? { id: first.id, name: first.name } : null;
}

async function findWhatsappInboxByPhoneNumberIdFromJson(
  organizationId: string | null,
  phoneNumberId: string,
): Promise<{ id: string; organizationId: string; channelConfig: unknown } | null> {
  const needle = phoneNumberId.trim();
  if (!needle) return null;

  const rows = await prisma.inbox.findMany({
    where: {
      channelType: InboxChannelType.WHATSAPP,
      ...(organizationId ? { organizationId } : {}),
      whatsappPhoneNumberId: null,
    },
    select: {
      id: true,
      organizationId: true,
      channelConfig: true,
      isDefault: true,
      createdAt: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  for (const row of rows) {
    const id = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappPhoneNumberId?.trim();
    if (id === needle) return row;
  }
  return null;
}

/** Localiza organização (e caixa) pelo phone_number_id Meta em qualquer caixa ou Settings legado. */
export async function findOrganizationByMetaPhoneNumberId(
  phoneNumberId: string,
): Promise<{ organizationId: string; inboxId?: string } | null> {
  const needle = phoneNumberId.trim();
  if (!needle) return null;

  const indexedMatches = await prisma.inbox.findMany({
    where: {
      channelType: InboxChannelType.WHATSAPP,
      whatsappPhoneNumberId: needle,
    },
    select: { id: true, organizationId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  if (indexedMatches.length > 0) {
    const indexed = indexedMatches[0];
    return { organizationId: indexed.organizationId, inboxId: indexed.id };
  }

  const legacy = await findWhatsappInboxByPhoneNumberIdFromJson(null, needle);
  if (legacy) {
    return { organizationId: legacy.organizationId, inboxId: legacy.id };
  }

  const settings = await prisma.settings.findFirst({
    where: { whatsappPhoneNumberId: needle },
    select: { organizationId: true },
  });
  if (settings) {
    const inbox = await findWhatsappInboxByPhoneNumberId(settings.organizationId, needle);
    return { organizationId: settings.organizationId, inboxId: inbox?.id };
  }
  return null;
}

export async function findWhatsappInboxByPhoneNumberId(
  organizationId: string,
  phoneNumberId: string,
): Promise<{ id: string; channelConfig: unknown } | null> {
  const needle = phoneNumberId.trim();
  if (!needle) return null;

  const indexed = await prisma.inbox.findFirst({
    where: {
      organizationId,
      channelType: InboxChannelType.WHATSAPP,
      whatsappPhoneNumberId: needle,
    },
    select: { id: true, channelConfig: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (indexed) return indexed;

  const legacy = await findWhatsappInboxByPhoneNumberIdFromJson(organizationId, needle);
  if (legacy) return legacy;

  // Settings legado: só quando existe uma única caixa WhatsApp na org (embedded signup).
  // Multi-inbox: não mapear phone_number_id via Settings — evita rotear para a caixa default
  // com credenciais antigas enquanto outra caixa Meta tem o número correto indexado.
  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, channelConfig: true },
  });
  if (!allowWhatsappSettingsPhoneInboxFallback(rows.length)) return null;

  const settings = await prisma.settings.findFirst({
    where: { organizationId, whatsappPhoneNumberId: needle },
    select: { whatsappProvider: true },
  });
  if (!settings || !isMetaCloudWhatsappProvider(settings.whatsappProvider)) {
    return null;
  }
  return rows[0];
}

export async function assertUniqueWhatsappProviderInOrg(
  organizationId: string,
  provider: string,
  excludeInboxId?: string,
): Promise<{ conflict: true; existingInboxName: string } | { conflict: false }> {
  if (whatsappProviderAllowsMultipleInboxes(provider)) return { conflict: false };
  const existing = await findWhatsappInboxByProvider(organizationId, provider, excludeInboxId);
  if (existing) {
    return { conflict: true, existingInboxName: existing.name };
  }
  return { conflict: false };
}

export async function assertUniqueWhatsappPhoneNumberIdInOrg(
  organizationId: string,
  phoneNumberId: string | null | undefined,
  excludeInboxId?: string,
): Promise<{ conflict: true; existingInboxName: string } | { conflict: false }> {
  const needle = phoneNumberId?.trim();
  if (!needle) return { conflict: false };
  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, name: true, channelConfig: true, whatsappPhoneNumberId: true },
  });
  for (const row of rows) {
    if (excludeInboxId && row.id === excludeInboxId) continue;
    const fromColumn = row.whatsappPhoneNumberId?.trim();
    const fromConfig = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappPhoneNumberId?.trim();
    if (fromColumn === needle || fromConfig === needle) {
      return { conflict: true, existingInboxName: row.name };
    }
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
