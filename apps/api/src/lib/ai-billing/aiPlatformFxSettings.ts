import { prisma } from "../../db.js";
import { config } from "../../config.js";

export const AI_PLATFORM_USD_BRL_RATE_KEY = "ai_platform_usd_brl_rate";

const DEFAULT_USD_BRL_RATE = 5.45;

export function readAiPlatformUsdBrlRate(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (raw && typeof raw === "object") {
    const rate = (raw as Record<string, unknown>).rate;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) return rate;
  }
  const envRate = Number.parseFloat(config.platformCreditsUsdBrlRate);
  if (Number.isFinite(envRate) && envRate > 0) return envRate;
  return DEFAULT_USD_BRL_RATE;
}

export async function getAiPlatformUsdBrlRate(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key: AI_PLATFORM_USD_BRL_RATE_KEY } });
  return readAiPlatformUsdBrlRate(row?.value);
}
