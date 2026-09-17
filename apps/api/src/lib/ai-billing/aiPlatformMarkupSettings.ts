import { prisma } from "../../db.js";
import { money, type MoneyDecimal } from "./money.js";

export const AI_PLATFORM_MARKUP_KEY = "ai_platform_markup";

export type AiPlatformMarkupSettings = {
  globalMarkupPercent: number;
  modelMarkupPercent: Record<string, number>;
};

export const DEFAULT_AI_PLATFORM_MARKUP: AiPlatformMarkupSettings = {
  globalMarkupPercent: 20,
  modelMarkupPercent: {},
};

export async function getAiPlatformMarkupSettings(): Promise<AiPlatformMarkupSettings> {
  const row = await prisma.platformSetting.findUnique({ where: { key: AI_PLATFORM_MARKUP_KEY } });
  return readAiPlatformMarkupSettings(row?.value);
}

export function readAiPlatformMarkupSettings(raw: unknown): AiPlatformMarkupSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const globalRaw = o.globalMarkupPercent;
  const globalMarkupPercent =
    typeof globalRaw === "number" && Number.isFinite(globalRaw) && globalRaw >= 0
      ? globalRaw
      : DEFAULT_AI_PLATFORM_MARKUP.globalMarkupPercent;

  const modelMarkupPercent: Record<string, number> = {};
  const modelsRaw = o.modelMarkupPercent;
  if (modelsRaw && typeof modelsRaw === "object") {
    for (const [key, value] of Object.entries(modelsRaw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        modelMarkupPercent[key.trim().toLowerCase()] = value;
      }
    }
  }

  return { globalMarkupPercent, modelMarkupPercent };
}

export async function patchAiPlatformMarkupSettings(
  patch: Partial<AiPlatformMarkupSettings>,
): Promise<AiPlatformMarkupSettings> {
  const current = await getAiPlatformMarkupSettings();
  const next: AiPlatformMarkupSettings = {
    globalMarkupPercent: patch.globalMarkupPercent ?? current.globalMarkupPercent,
    modelMarkupPercent: patch.modelMarkupPercent ?? current.modelMarkupPercent,
  };
  await prisma.platformSetting.upsert({
    where: { key: AI_PLATFORM_MARKUP_KEY },
    create: { key: AI_PLATFORM_MARKUP_KEY, value: next },
    update: { value: next },
  });
  return next;
}

export function resolveMarkupPercentForModel(
  settings: AiPlatformMarkupSettings,
  model: string,
): number {
  const modelKey = model.trim().toLowerCase();
  const specific = settings.modelMarkupPercent[modelKey];
  if (typeof specific === "number" && Number.isFinite(specific)) return specific;
  return settings.globalMarkupPercent;
}

export function applyMarkup(providerCost: MoneyDecimal, markupPercent: number): MoneyDecimal {
  const factor = 1 + Math.max(0, markupPercent) / 100;
  return money(providerCost).mul(factor);
}
