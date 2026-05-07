import { prisma } from "../db.js";
import type { Settings } from "@prisma/client";

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

export function parseEvolutionPlatformValue(raw: unknown): EvolutionPlatformConfig | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    enabled: r.enabled === true,
    tenantQrOnly: r.tenantQrOnly === true,
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

export function isEvolutionQrModeActive(cfg: EvolutionPlatformConfig | null): cfg is EvolutionPlatformConfig {
  return !!(
    cfg?.enabled &&
    cfg.tenantQrOnly &&
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
  const apiKey = settings.whatsappApiKey?.trim() ?? "";
  if (!baseUrl || !apiKey) return null;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    instanceName,
  };
}
