import type { Settings } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";

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

export async function resolveEvolutionGoCredentials(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey" | "whatsappPhoneNumberId">,
): Promise<{ baseUrl: string; apiKey: string; instanceId: string } | null> {
  if (settings.whatsappProvider !== "evolution_go") return null;

  const instanceId = settings.whatsappPhoneNumberId?.trim() ?? "";
  if (!instanceId) return null;

  const api = await resolveEvolutionGoApiConnection(settings);
  if (!api) return null;

  return { ...api, instanceId };
}

export async function resolveEvolutionGoApiConnection(
  settings: Pick<Settings, "whatsappProvider" | "evolutionApiBaseUrl" | "whatsappApiKey">,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  if (settings.whatsappProvider !== "evolution_go") return null;

  const platform = await getEvolutionGoPlatformConfig();
  if (isEvolutionGoPlatformModeActive(platform)) {
    return {
      baseUrl: platform.baseUrl.replace(/\/+$/, ""),
      apiKey: platform.globalApiKey.trim(),
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
  };
}
