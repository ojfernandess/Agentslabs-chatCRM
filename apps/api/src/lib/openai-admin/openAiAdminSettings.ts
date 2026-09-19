import { prisma } from "../../db.js";
import { config } from "../../config.js";

/** Chave em `platform_settings` — Admin API Key OpenAI (Super Admin). */
export const OPENAI_ADMIN_PLATFORM_KEY = "openai_admin";

export const MASKED_OPENAI_ADMIN_KEY = "••••••••";

export type OpenAiAdminSettings = {
  adminApiKey: string;
  /** Saldo inicial conhecido (USD) para estimativa quando não há API oficial de saldo. */
  initialBalanceUsd: number | null;
};

export type OpenAiAdminSettingsPublic = {
  configured: boolean;
  connected: boolean;
  adminApiKeyMasked: string;
  initialBalanceUsd: string | null;
  lastSyncedAt: string | null;
};

function parseInitialBalance(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function parseOpenAiAdminSettings(raw: unknown): OpenAiAdminSettings | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const adminApiKey = String(o.adminApiKey ?? "").trim();
  if (!adminApiKey) return null;
  return {
    adminApiKey,
    initialBalanceUsd: parseInitialBalance(o.initialBalanceUsd),
  };
}

export function maskOpenAiAdminKeyPreview(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return MASKED_OPENAI_ADMIN_KEY;
  const prefix = v.startsWith("sk-") ? v.slice(0, v.indexOf("-", 3) + 1) || v.slice(0, 7) : v.slice(0, 8);
  return `${prefix}${"•".repeat(12)}${v.slice(-4)}`;
}

export async function getOpenAiAdminSettingsFromDb(): Promise<OpenAiAdminSettings | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: OPENAI_ADMIN_PLATFORM_KEY } });
  const parsed = parseOpenAiAdminSettings(row?.value);
  if (parsed) return parsed;
  const envKey = config.openAiAdminKey.trim();
  if (!envKey) return null;
  return { adminApiKey: envKey, initialBalanceUsd: null };
}

export async function resolveOpenAiAdminApiKey(): Promise<string | null> {
  const settings = await getOpenAiAdminSettingsFromDb();
  return settings?.adminApiKey?.trim() || null;
}

export async function getLatestOpenAiSyncAt(): Promise<Date | null> {
  const row = await prisma.openAiAdminSyncSnapshot.findFirst({
    where: { errorMessage: null },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  return row?.syncedAt ?? null;
}

export async function getOpenAiAdminSettingsPublic(): Promise<OpenAiAdminSettingsPublic> {
  const row = await prisma.platformSetting.findUnique({ where: { key: OPENAI_ADMIN_PLATFORM_KEY } });
  const parsed = parseOpenAiAdminSettings(row?.value);
  const envKey = config.openAiAdminKey.trim();
  const apiKey = parsed?.adminApiKey ?? envKey;
  const lastSyncedAt = await getLatestOpenAiSyncAt();

  if (!apiKey) {
    return {
      configured: false,
      connected: false,
      adminApiKeyMasked: "",
      initialBalanceUsd: parsed?.initialBalanceUsd != null ? parsed.initialBalanceUsd.toFixed(2) : null,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    };
  }

  return {
    configured: true,
    connected: Boolean(lastSyncedAt),
    adminApiKeyMasked: maskOpenAiAdminKeyPreview(apiKey),
    initialBalanceUsd: parsed?.initialBalanceUsd != null ? parsed.initialBalanceUsd.toFixed(2) : null,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  };
}

export async function upsertOpenAiAdminSettings(input: {
  adminApiKey?: string;
  initialBalanceUsd?: number | null;
}): Promise<OpenAiAdminSettingsPublic> {
  const existing = await prisma.platformSetting.findUnique({ where: { key: OPENAI_ADMIN_PLATFORM_KEY } });
  const current = parseOpenAiAdminSettings(existing?.value);
  const envFallback = config.openAiAdminKey.trim();

  let adminApiKey = current?.adminApiKey ?? envFallback;
  if (input.adminApiKey != null) {
    const trimmed = input.adminApiKey.trim();
    if (trimmed && trimmed !== MASKED_OPENAI_ADMIN_KEY && !trimmed.includes("•")) {
      adminApiKey = trimmed;
    }
  }

  const initialBalanceUsd =
    input.initialBalanceUsd !== undefined ? input.initialBalanceUsd : (current?.initialBalanceUsd ?? null);

  if (!adminApiKey) {
    throw new Error("Admin API Key is required");
  }

  const value = {
    adminApiKey,
    initialBalanceUsd,
  };

  await prisma.platformSetting.upsert({
    where: { key: OPENAI_ADMIN_PLATFORM_KEY },
    create: { key: OPENAI_ADMIN_PLATFORM_KEY, value },
    update: { value },
  });

  return getOpenAiAdminSettingsPublic();
}
