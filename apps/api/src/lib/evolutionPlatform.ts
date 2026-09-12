import { InboxChannelType, type Settings } from "@prisma/client";
import { webhookUrlForInbox } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import { evolutionApiSetWebhook } from "./evolutionInstanceApi.js";
import { resolveInboxWhatsappCredentials } from "./inboxWhatsappConfig.js";

export const EVOLUTION_PLATFORM_KEY = "evolution_platform";

export type EvolutionPlatformConfig = {
  enabled: boolean;
  baseUrl: string;
  globalApiKey: string;
  tenantQrOnly: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function coerceBool(v: unknown, defaultTrue = false): boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return defaultTrue;
}

export function parseEvolutionPlatformValue(raw: unknown): EvolutionPlatformConfig | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    enabled: coerceBool(r.enabled, false),
    /** Legacy field; tenant QR/UI uses platform credentials whenever enabled+URL+key (see isEvolutionQrModeActive). */
    tenantQrOnly: coerceBool(r.tenantQrOnly, true),
    baseUrl: String(r.baseUrl ?? "").trim(),
    globalApiKey: String(r.globalApiKey ?? "").trim(),
  };
}

export async function getEvolutionPlatformConfig(): Promise<EvolutionPlatformConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: EVOLUTION_PLATFORM_KEY },
  });
  return parseEvolutionPlatformValue(row?.value);
}

/** Evolution gerida: plataforma tem URL + chave; tenants criam instância e ligam por QR (sem pedir URL/chave no painel). */
export function isEvolutionQrModeActive(cfg: EvolutionPlatformConfig | null): cfg is EvolutionPlatformConfig {
  return !!(
    cfg?.enabled &&
    cfg.baseUrl.trim().length > 0 &&
    cfg.globalApiKey.trim().length > 0
  );
}

export async function evolutionPlatformQrModeActive(): Promise<boolean> {
  const cfg = await getEvolutionPlatformConfig();
  return isEvolutionQrModeActive(cfg);
}

/**
 * Resolve Evolution REST credentials for a tenant.
 * In QR / managed mode the platform base URL and global API key are used; the tenant only stores the instance name.
 */
export async function resolveEvolutionApiCredentials(
  settings: Pick<
    Settings,
    "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappPhoneNumberId" | "whatsappApiKey"
  >,
): Promise<{ baseUrl: string; apiKey: string; instanceName: string } | null> {
  if (settings.whatsappProvider !== "evolution") return null;

  const instanceName = settings.whatsappPhoneNumberId?.trim() ?? "";
  if (!instanceName) return null;

  const platform = await getEvolutionPlatformConfig();
  if (isEvolutionQrModeActive(platform)) {
    return {
      baseUrl: platform.baseUrl.replace(/\/+$/, ""),
      apiKey: platform.globalApiKey.trim(),
      instanceName,
    };
  }

  const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
  const apiKeyEncrypted = settings.whatsappApiKey?.trim() ?? "";
  if (!baseUrl || !apiKeyEncrypted) return null;

  const apiKey = decrypt(apiKeyEncrypted) ?? "";
  if (!apiKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    instanceName,
  };
}

type EvolutionWebhookLogger = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

/**
 * Regista o webhook OpenConduit na instância Evolution (MESSAGES_UPSERT, etc.).
 * Necessário para inbound — o envio outbound usa REST e funciona sem isto.
 */
export async function syncEvolutionApiWebhookForInbox(
  organizationId: string,
  inboxId: string,
  log?: EvolutionWebhookLogger,
  channelConfigOverride?: unknown,
): Promise<{ ok: true } | { ok: false; status: number; body: string } | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { channelConfig: true },
  });
  const effectiveConfig = channelConfigOverride ?? inbox?.channelConfig;
  if (!effectiveConfig) return null;

  const creds = await resolveInboxWhatsappCredentials(organizationId, {
    channelConfig: effectiveConfig,
  });
  if (!creds || creds.whatsappProvider !== "evolution") return null;

  const resolved = await resolveEvolutionApiCredentials(creds);
  if (!resolved) return null;

  const webhookUrl = webhookUrlForInbox(organizationId, inboxId);
  const inboxSecret = creds.whatsappWebhookSecret ? decrypt(creds.whatsappWebhookSecret) : null;
  let effectiveSecret = inboxSecret?.trim() ?? "";
  if (!effectiveSecret) {
    const orgSettings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { whatsappWebhookSecret: true },
    });
    effectiveSecret = decrypt(orgSettings?.whatsappWebhookSecret ?? "")?.trim() ?? "";
  }
  const webhookHeaders = effectiveSecret ? { "x-openconduit-token": effectiveSecret } : undefined;

  const setWh = await evolutionApiSetWebhook({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    instanceName: resolved.instanceName,
    webhookUrl,
    webhookHeaders,
  });

  if (!setWh.ok) {
    log?.warn(
      {
        status: setWh.status,
        body: setWh.body.slice(0, 400),
        inboxId,
        instanceName: resolved.instanceName,
        webhookUrl,
      },
      "Evolution POST /webhook/set failed for inbox",
    );
  }

  return setWh.ok ? { ok: true } : setWh;
}
