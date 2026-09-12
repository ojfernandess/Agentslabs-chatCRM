import { InboxChannelType, type Prisma, type Settings } from "@prisma/client";
import { webhookUrlForInbox, webhookUrlForOrganization } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import {
  evolutionApiResolveInstanceName,
  evolutionApiSetWebhook,
} from "./evolutionInstanceApi.js";
import {
  findWhatsappInboxByProvider,
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
} from "./inboxWhatsappConfig.js";
import { syncWhatsappInboxCredentialsToSettings } from "./whatsappOrgSync.js";

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

export type EvolutionQrFlowContext = {
  instanceName: string;
  webhookUrl: string;
  evolutionInboxId: string | null;
};

function channelConfigRecord(cfg: unknown): Record<string, unknown> {
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? { ...(cfg as Record<string, unknown>) } : {};
}

/** Resolve instância + URL de webhook para fluxo QR (Settings, caixa evolution ou nome automático). */
export async function resolveEvolutionQrFlowContext(
  organizationId: string,
  opts?: { preferInstanceName?: string },
): Promise<EvolutionQrFlowContext | null> {
  const platform = await getEvolutionPlatformConfig();
  if (!isEvolutionQrModeActive(platform)) return null;

  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  const evolutionInbox = await findWhatsappInboxByProvider(organizationId, "evolution");

  let inboxInstance = "";
  if (evolutionInbox) {
    const row = await prisma.inbox.findUnique({
      where: { id: evolutionInbox.id },
      select: { channelConfig: true },
    });
    inboxInstance =
      parseInboxWhatsappFromChannelConfig(row?.channelConfig).whatsappPhoneNumberId?.trim() ?? "";
  }

  const prefer = opts?.preferInstanceName?.trim();
  const instanceName =
    prefer ||
    settings?.whatsappPhoneNumberId?.trim() ||
    inboxInstance ||
    "";

  if (!instanceName) return null;

  const webhookUrl = evolutionInbox
    ? webhookUrlForInbox(organizationId, evolutionInbox.id)
    : webhookUrlForOrganization(organizationId);

  return {
    instanceName,
    webhookUrl,
    evolutionInboxId: evolutionInbox?.id ?? null,
  };
}

/** Credenciais da plataforma Evolution (modo QR) para uma instância conhecida. */
export async function resolveEvolutionQrPlatformCredentials(
  instanceName: string,
): Promise<{ baseUrl: string; apiKey: string; instanceName: string } | null> {
  const platform = await getEvolutionPlatformConfig();
  if (!isEvolutionQrModeActive(platform)) return null;
  const name = instanceName.trim();
  if (!name) return null;
  return {
    baseUrl: platform.baseUrl.replace(/\/+$/, ""),
    apiKey: platform.globalApiKey.trim(),
    instanceName: name,
  };
}

/** Alinha caixa WhatsApp evolution com a instância ligada por QR e espelha em Settings. */
export async function patchEvolutionInboxAfterQrFlow(
  organizationId: string,
  instanceName: string,
): Promise<string | null> {
  const evolutionInbox = await findWhatsappInboxByProvider(organizationId, "evolution");
  if (!evolutionInbox) return null;

  const row = await prisma.inbox.findUnique({
    where: { id: evolutionInbox.id },
    select: { channelConfig: true },
  });
  const base = channelConfigRecord(row?.channelConfig);
  base.whatsappProvider = "evolution";
  base.whatsappPhoneNumberId = instanceName.trim();
  delete base.evolutionApiBaseUrl;

  await prisma.inbox.update({
    where: { id: evolutionInbox.id },
    data: { channelConfig: base as Prisma.InputJsonValue },
  });
  await syncWhatsappInboxCredentialsToSettings(organizationId, evolutionInbox.id);
  return evolutionInbox.id;
}

/**
 * Regista webhook na Evolution com eventos MESSAGES_UPSERT (inbound).
 * Usa URL da caixa evolution quando existir; senão URL da organização.
 */
export async function syncEvolutionQrWebhooksForOrganization(
  organizationId: string,
  instanceName: string,
  log?: EvolutionWebhookLogger,
): Promise<
  | { ok: true; webhookUrl: string; instanceName: string; attempt?: string }
  | { ok: false; status: number; body: string; webhookUrl: string; instanceName: string; attempts?: string[] }
> {
  const creds = await resolveEvolutionQrPlatformCredentials(instanceName);
  if (!creds) {
    return {
      ok: false,
      status: 400,
      body: "Evolution QR mode not active",
      webhookUrl: "",
      instanceName,
    };
  }

  const resolved = await evolutionApiResolveInstanceName(
    creds.baseUrl,
    creds.apiKey,
    creds.instanceName,
    organizationId,
  );
  const effectiveInstance = resolved.name;

  if (resolved.corrected && effectiveInstance) {
    await prisma.settings.update({
      where: { organizationId },
      data: {
        whatsappProvider: "evolution",
        whatsappPhoneNumberId: effectiveInstance,
      },
    });
    await patchEvolutionInboxAfterQrFlow(organizationId, effectiveInstance);
  }

  const evolutionInbox = await findWhatsappInboxByProvider(organizationId, "evolution");
  const webhookUrl = evolutionInbox
    ? webhookUrlForInbox(organizationId, evolutionInbox.id)
    : webhookUrlForOrganization(organizationId);

  const orgSettings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { whatsappWebhookSecret: true },
  });
  const effectiveSecret = decrypt(orgSettings?.whatsappWebhookSecret ?? "")?.trim() ?? "";
  const webhookHeaders = effectiveSecret ? { "x-openconduit-token": effectiveSecret } : undefined;

  const setWh = await evolutionApiSetWebhook({
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    instanceName: effectiveInstance,
    webhookUrl,
    webhookHeaders,
  });

  if (!setWh.ok) {
    log?.warn(
      {
        status: setWh.status,
        body: setWh.body.slice(0, 400),
        instanceName: effectiveInstance,
        preferredInstance: creds.instanceName,
        webhookUrl,
        attempts: setWh.attempts,
      },
      "Evolution POST /webhook/set failed (QR flow)",
    );
    return {
      ok: false,
      status: setWh.status,
      body: setWh.body,
      webhookUrl,
      instanceName: effectiveInstance,
      attempts: setWh.attempts,
    };
  }

  if (evolutionInbox) {
    await syncEvolutionApiWebhookForInbox(organizationId, evolutionInbox.id, log);
  }

  return { ok: true, webhookUrl, instanceName: effectiveInstance, attempt: setWh.attempt };
}

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
