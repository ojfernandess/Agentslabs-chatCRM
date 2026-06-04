import { MASKED_WHATSAPP_SECRET } from "./whatsappOrgConfig";

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

export { MASKED_WHATSAPP_SECRET };

function asRecord(cfg: unknown): Record<string, unknown> | null {
  return cfg !== null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
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
  return key.length > 0;
}

export function isInboxWhatsappConfigured(fields: InboxWhatsappConfigFields): boolean {
  const p = fields.whatsappProvider;
  if (!p) return false;
  const hasInstance = Boolean(fields.whatsappPhoneNumberId?.trim());
  if (p === "meta" || p === "360dialog" || p === "twilio") {
    return hasInstance && hasWhatsappApiKeyStored(fields);
  }
  return hasInstance;
}

export function isWhatsAppCloudApiProvider(provider: string): boolean {
  return provider === "meta" || provider === "360dialog";
}

export function mergeWhatsappMetaChannelConfig(
  cfg: unknown,
  patch: { whatsappDisplayPhone?: string; whatsappBusinessAccountId?: string },
): Record<string, unknown> {
  const base = asRecord(cfg) ?? {};
  const phone = patch.whatsappDisplayPhone?.trim();
  const waba = patch.whatsappBusinessAccountId?.trim();
  if (phone) base.whatsappDisplayPhone = phone;
  else delete base.whatsappDisplayPhone;
  if (waba) base.whatsappBusinessAccountId = waba;
  else delete base.whatsappBusinessAccountId;
  return base;
}

export function buildInboxWhatsappChannelConfig(
  cfg: unknown,
  patch: {
    whatsappProvider: string;
    whatsappPhoneNumberId?: string;
    whatsappApiKey?: string;
    whatsappWebhookSecret?: string;
    evolutionApiBaseUrl?: string;
    whatsappDisplayPhone?: string;
    whatsappBusinessAccountId?: string;
  },
): Record<string, unknown> {
  const base = mergeWhatsappMetaChannelConfig(cfg, {
    whatsappDisplayPhone: patch.whatsappDisplayPhone,
    whatsappBusinessAccountId: patch.whatsappBusinessAccountId,
  });
  base.whatsappProvider = patch.whatsappProvider;
  const phoneId = patch.whatsappPhoneNumberId?.trim();
  if (phoneId) base.whatsappPhoneNumberId = phoneId;
  const apiKey = patch.whatsappApiKey?.trim();
  if (apiKey && apiKey !== MASKED_WHATSAPP_SECRET) {
    base.whatsappApiKey = apiKey;
  } else {
    delete base.whatsappApiKey;
  }
  const secret = patch.whatsappWebhookSecret?.trim();
  if (secret && secret !== MASKED_WHATSAPP_SECRET) {
    base.whatsappWebhookSecret = secret;
  } else {
    delete base.whatsappWebhookSecret;
  }
  const evo = patch.evolutionApiBaseUrl?.trim();
  if (evo) base.evolutionApiBaseUrl = evo;
  else if (patch.whatsappProvider !== "evolution" && patch.whatsappProvider !== "evolution_go") {
    delete base.evolutionApiBaseUrl;
  }
  return base;
}

export type WhatsappInboxSummary = {
  id: string;
  name: string;
  provider: string | null;
};

export function summarizeWhatsappInboxes(
  rows: { id: string; name: string; channelType: string; channelConfig?: unknown }[],
): WhatsappInboxSummary[] {
  return rows
    .filter((r) => r.channelType === "WHATSAPP")
    .map((r) => ({
      id: r.id,
      name: r.name,
      provider: parseInboxWhatsappFromChannelConfig(r.channelConfig).whatsappProvider ?? null,
    }));
}
