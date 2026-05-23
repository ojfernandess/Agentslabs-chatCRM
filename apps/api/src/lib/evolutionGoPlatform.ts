import type { Settings } from "@prisma/client";
import { prisma } from "../db.js";
import { webhookUrlForInbox, webhookUrlForOrganization } from "../config.js";
import { decrypt, encrypt } from "./encryption.js";
import {
  evolutionGoFetchAllInstances,
  evolutionGoGetStatus,
  evolutionGoLookupInstanceByRef,
  type EvolutionGoInstanceInfo,
} from "./evolutionGoApi.js";
import { findWhatsappInboxByProvider, parseInboxWhatsappFromChannelConfig } from "./inboxWhatsappConfig.js";
import { getDefaultInboxId } from "./defaultInbox.js";

const EVOLUTION_GO_PROVIDER = "evolution_go" as const;

export const EVOLUTION_GO_PLATFORM_KEY = "evolution_go_platform";

export type EvolutionGoPlatformConfig = {
  enabled: boolean;
  baseUrl: string;
  globalApiKey: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function coerceBool(v: unknown, defaultTrue = false): boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return defaultTrue;
}

export function parseEvolutionGoPlatformValue(raw: unknown): EvolutionGoPlatformConfig | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    enabled: coerceBool(r.enabled, false),
    baseUrl: String(r.baseUrl ?? "").trim(),
    globalApiKey: String(r.globalApiKey ?? "").trim(),
  };
}

export async function getEvolutionGoPlatformConfig(): Promise<EvolutionGoPlatformConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: EVOLUTION_GO_PLATFORM_KEY },
  });
  return parseEvolutionGoPlatformValue(row?.value);
}

export function isEvolutionGoPlatformModeActive(cfg: EvolutionGoPlatformConfig | null): cfg is EvolutionGoPlatformConfig {
  return !!(cfg?.enabled && cfg.baseUrl.trim().length > 0 && cfg.globalApiKey.trim().length > 0);
}

export async function evolutionGoPlatformModeActive(): Promise<boolean> {
  const cfg = await getEvolutionGoPlatformConfig();
  return isEvolutionGoPlatformModeActive(cfg);
}

/** Ensures tenant settings exist with evolution_go selected (required before Evolution Go API routes). */
export async function ensureEvolutionGoProviderSelected(organizationId: string): Promise<Settings | null> {
  let settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (settings?.whatsappProvider === EVOLUTION_GO_PROVIDER) return settings;

  const platformActive = await evolutionGoPlatformModeActive();
  if (!platformActive) return null;

  if (!settings) {
    return prisma.settings.create({
      data: { organizationId, whatsappProvider: EVOLUTION_GO_PROVIDER },
    });
  }
  return prisma.settings.update({
    where: { organizationId },
    data: { whatsappProvider: EVOLUTION_GO_PROVIDER },
  });
}

export async function resolveEvolutionGoCredentials(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey" | "whatsappPhoneNumberId">,
): Promise<{ baseUrl: string; apiKey: string; instanceId?: string } | null> {
  const platform = await getEvolutionGoPlatformConfig();
  const instanceId = settings.whatsappPhoneNumberId?.trim() ?? "";

  if (isEvolutionGoPlatformModeActive(platform)) {
    const instanceToken = decrypt(settings.whatsappApiKey?.trim() ?? "")?.trim() ?? "";
    if (instanceToken) {
      return { baseUrl: platform.baseUrl.replace(/\/+$/, ""), apiKey: instanceToken };
    }
    if (!instanceId) return null;
    return { baseUrl: platform.baseUrl.replace(/\/+$/, ""), apiKey: platform.globalApiKey.trim(), instanceId };
  }

  if (settings.whatsappProvider !== EVOLUTION_GO_PROVIDER) return null;

  const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
  const apiKeyEncrypted = settings.whatsappApiKey?.trim() ?? "";
  if (!baseUrl || !apiKeyEncrypted) return null;

  const apiKey = decrypt(apiKeyEncrypted)?.trim() ?? "";
  if (!apiKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    ...(instanceId ? { instanceId } : {}),
  };
}

export async function resolveEvolutionGoApiConnection(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey">,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const platform = await getEvolutionGoPlatformConfig();
  if (isEvolutionGoPlatformModeActive(platform)) {
    return {
      baseUrl: platform.baseUrl.replace(/\/+$/, ""),
      apiKey: platform.globalApiKey.trim(),
    };
  }

  if (settings.whatsappProvider !== EVOLUTION_GO_PROVIDER) return null;

  const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
  const apiKeyEncrypted = settings.whatsappApiKey?.trim() ?? "";
  if (!baseUrl || !apiKeyEncrypted) return null;

  const apiKey = decrypt(apiKeyEncrypted) ?? "";
  if (!apiKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
  };
}

export type EvolutionGoOperationAuth = {
  baseUrl: string;
  /** Instance token — Evolution Go identifies the instance via apikey header. */
  apiKey: string;
};

export type EvolutionGoStatusResult = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
  unreachable?: boolean;
};

/** Prefix for instance names created by this organization (multi-tenant isolation on shared Evolution Go). */
export function evolutionGoOrgInstancePrefix(organizationId: string): string {
  return `oc-${organizationId.replace(/-/g, "").slice(0, 12)}`;
}

export function evolutionGoScopedInstanceName(organizationId: string, label: string): string {
  const prefix = evolutionGoOrgInstancePrefix(organizationId);
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "main";
  return `${prefix}-${safe}`.slice(0, 80);
}

export function evolutionGoInstanceBelongsToOrg(
  organizationId: string,
  instance: { id: string; name: string },
): boolean {
  const prefix = evolutionGoOrgInstancePrefix(organizationId);
  return instance.name === prefix || instance.name.startsWith(`${prefix}-`);
}

/** Lista apenas instâncias desta organização (prefixo oc-); legado: só a instância selecionada. */
export function filterEvolutionGoInstancesForOrg(
  organizationId: string,
  instances: EvolutionGoInstanceInfo[],
  selectedRef?: string,
): EvolutionGoInstanceInfo[] {
  const prefixed = instances.filter((x) => evolutionGoInstanceBelongsToOrg(organizationId, x));
  if (prefixed.length > 0) return prefixed;
  const ref = selectedRef?.trim();
  if (!ref) return [];
  const one = instances.find((x) => x.id === ref || x.name === ref);
  return one ? [one] : [];
}

function webhookPayloadRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** Detecta POST do Evolution Go (não Evolution API v2 MESSAGES_UPSERT). */
export function isEvolutionGoWebhookPayload(body: unknown): boolean {
  const env = webhookPayloadRecord(body);
  if (!env) return false;
  if (typeof env.instanceToken === "string" && env.instanceToken.trim()) return true;
  const ev = typeof env.event === "string" ? env.event.trim() : "";
  const evU = ev.toUpperCase();
  if (
    evU === "MESSAGE" ||
    evU === "READ_RECEIPT" ||
    evU === "CONNECTION" ||
    evU === "QRCODE" ||
    evU === "GROUP" ||
    evU === "CALL" ||
    evU === "SEND_MESSAGE"
  ) {
    return true;
  }
  if (ev === "Message" || ev === "Receipt") return true;
  const data = webhookPayloadRecord(env.data);
  if (data?.Info || data?.info || data?.key || data?.Message || data?.message) return true;
  return false;
}

export function evolutionGoWebhookMatchesOrgInstance(
  body: unknown,
  settings: Pick<Settings, "whatsappPhoneNumberId" | "whatsappApiKey">,
  organizationId?: string,
): boolean {
  const env = webhookPayloadRecord(body);
  if (!env) return true;

  const token = typeof env.instanceToken === "string" ? env.instanceToken.trim() : "";
  const orgToken = decrypt(settings.whatsappApiKey?.trim() ?? "")?.trim() ?? "";
  if (token && orgToken && token === orgToken) return true;

  const orgRef = settings.whatsappPhoneNumberId?.trim() ?? "";
  const payloadId = typeof env.instanceId === "string" ? env.instanceId.trim() : "";
  const payloadName = typeof env.instance === "string" ? env.instance.trim() : "";

  if (!orgRef && !orgToken) return true;
  if (payloadId && orgRef && payloadId === orgRef) return true;
  if (payloadName && orgRef && payloadName === orgRef) return true;

  if (organizationId && payloadName) {
    const prefix = evolutionGoOrgInstancePrefix(organizationId);
    if (payloadName === prefix || payloadName.startsWith(`${prefix}-`)) return true;
  }

  if (!payloadId && !payloadName) return true;

  return false;
}

/** Caixa WhatsApp com provider evolution_go (ou default se só Settings tiver evolution_go). */
export async function findEvolutionGoWhatsappInboxId(organizationId: string): Promise<string | null> {
  const byProvider = await findWhatsappInboxByProvider(organizationId, EVOLUTION_GO_PROVIDER);
  if (byProvider) return byProvider.id;

  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { whatsappProvider: true },
  });
  if (settings?.whatsappProvider !== EVOLUTION_GO_PROVIDER) return null;

  try {
    return await getDefaultInboxId(organizationId);
  } catch {
    return null;
  }
}

/** URL de webhook gravada no Evolution Go: preferir caixa evolution_go quando existir. */
export async function evolutionGoWebhookUrlForOrganization(organizationId: string): Promise<string> {
  const inboxId = await findEvolutionGoWhatsappInboxId(organizationId);
  if (inboxId) return webhookUrlForInbox(organizationId, inboxId);
  return webhookUrlForOrganization(organizationId);
}

export async function listEvolutionGoInstancesForOrg(
  organizationId: string,
  selectedRef?: string,
): Promise<EvolutionGoInstanceInfo[] | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings) return null;
  const api = await resolveEvolutionGoApiConnection(settings);
  if (!api) return null;
  const all = await evolutionGoFetchAllInstances({ baseUrl: api.baseUrl, apiKey: api.apiKey });
  if (!all) return null;
  return filterEvolutionGoInstancesForOrg(organizationId, all, selectedRef ?? settings.whatsappPhoneNumberId ?? undefined);
}

/** Resolves instance token for Evolution Go API calls (connect, QR, status). Persists token when discovered. */
export async function resolveEvolutionGoOperationAuth(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey" | "whatsappPhoneNumberId">,
  organizationId?: string,
): Promise<EvolutionGoOperationAuth | null> {
  const creds = await resolveEvolutionGoCredentials(settings);
  if (!creds) return null;

  let apiKey = creds.apiKey;
  const instanceRef = creds.instanceId;

  const platform = await getEvolutionGoPlatformConfig();
  const storedToken = decrypt(settings.whatsappApiKey?.trim() ?? "")?.trim() ?? "";

  if (!storedToken && instanceRef && isEvolutionGoPlatformModeActive(platform)) {
    const found = await evolutionGoLookupInstanceByRef({
      baseUrl: platform.baseUrl,
      apiKey: platform.globalApiKey,
      instanceRef,
    });
    if (found?.token) {
      apiKey = found.token;
      if (organizationId) {
        await prisma.settings.update({
          where: { organizationId },
          data: {
            whatsappApiKey: encrypt(found.token),
            whatsappPhoneNumberId: found.id,
          },
        });
      }
    }
  }

  if (
    instanceRef &&
    isEvolutionGoPlatformModeActive(platform) &&
    apiKey === platform.globalApiKey.trim()
  ) {
    return null;
  }

  return { baseUrl: creds.baseUrl, apiKey };
}

/** Resolves credentials and fetches instance status without surfacing HTTP 502 for transient upstream errors. */
export async function fetchEvolutionGoInstanceStatus(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey" | "whatsappPhoneNumberId">,
  organizationId?: string,
): Promise<EvolutionGoStatusResult> {
  const disconnected: EvolutionGoStatusResult = {
    connected: false,
    loggedIn: false,
    name: "",
    unreachable: true,
  };

  const auth = await resolveEvolutionGoOperationAuth(settings, organizationId);
  if (!auth) return disconnected;

  const st = await evolutionGoGetStatus({
    baseUrl: auth.baseUrl,
    apiKey: auth.apiKey,
  });
  if (st) {
    return { ...st, unreachable: false };
  }
  return disconnected;
}

export async function resolveEvolutionGoInstanceConnection(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey">,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const platform = await getEvolutionGoPlatformConfig();
  if (isEvolutionGoPlatformModeActive(platform)) {
    const instanceToken = decrypt(settings.whatsappApiKey?.trim() ?? "")?.trim() ?? "";
    if (!instanceToken) return null;
    return { baseUrl: platform.baseUrl.replace(/\/+$/, ""), apiKey: instanceToken };
  }

  if (settings.whatsappProvider !== EVOLUTION_GO_PROVIDER) return null;

  const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
  const apiKeyEncrypted = settings.whatsappApiKey?.trim() ?? "";
  if (!baseUrl || !apiKeyEncrypted) return null;

  const apiKey = decrypt(apiKeyEncrypted)?.trim() ?? "";
  if (!apiKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
  };
}
