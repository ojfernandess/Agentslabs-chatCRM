import type { Settings } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt, encrypt } from "./encryption.js";
import { evolutionGoGetStatus, evolutionGoLookupInstanceByRef } from "./evolutionGoApi.js";

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

export type EvolutionGoStatusResult = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
  unreachable?: boolean;
};

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

  const creds = await resolveEvolutionGoCredentials(settings);
  if (!creds) return disconnected;

  let apiKey = creds.apiKey;
  let instanceRef = creds.instanceId;

  const platform = await getEvolutionGoPlatformConfig();
  const storedToken = decrypt(settings.whatsappApiKey?.trim() ?? "")?.trim() ?? "";
  if (instanceRef && isEvolutionGoPlatformModeActive(platform) && !storedToken) {
    const found = await evolutionGoLookupInstanceByRef({
      baseUrl: platform.baseUrl,
      apiKey: platform.globalApiKey,
      instanceRef,
    });
    if (found?.token) {
      apiKey = found.token;
      instanceRef = undefined;
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

  const st = await evolutionGoGetStatus({
    baseUrl: creds.baseUrl,
    apiKey,
    instanceRef,
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
