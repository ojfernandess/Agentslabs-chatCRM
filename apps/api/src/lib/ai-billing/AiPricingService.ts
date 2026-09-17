import type { AiModelPricing } from "@prisma/client";
import { prisma } from "../../db.js";
import { applyMarkup, getAiPlatformMarkupSettings, resolveMarkupPercentForModel } from "./aiPlatformMarkupSettings.js";
import {
  costFromTokensPerMillion,
  money,
  moneyAdd,
  moneyToApiString,
  moneyZero,
  type MoneyDecimal,
} from "./money.js";
import type { LlmUsageDetails } from "./llmUsageDetails.js";

export type AiUsageCostBreakdown = {
  pricingVersionId: string;
  provider: string;
  model: string;
  currency: string;
  markupPercent: number;
  providerCost: MoneyDecimal;
  platformCost: MoneyDecimal;
};

export async function resolveActiveModelPricing(input: {
  provider: string;
  model: string;
  at?: Date;
}): Promise<AiModelPricing | null> {
  const at = input.at ?? new Date();
  const provider = input.provider.trim().toLowerCase();
  const model = input.model.trim();

  const exact = await prisma.aiModelPricing.findFirst({
    where: {
      provider,
      model,
      active: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (exact) return exact;

  return prisma.aiModelPricing.findFirst({
    where: {
      provider,
      active: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

export function calculateProviderCostFromPricing(
  pricing: Pick<
    AiModelPricing,
    "inputPrice" | "cachedInputPrice" | "outputPrice" | "reasoningPrice"
  >,
  usage: Pick<LlmUsageDetails, "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens">,
): MoneyDecimal {
  let total = moneyZero();
  total = moneyAdd(total, costFromTokensPerMillion(usage.inputTokens, pricing.inputPrice));
  if (pricing.cachedInputPrice) {
    total = moneyAdd(total, costFromTokensPerMillion(usage.cachedInputTokens, pricing.cachedInputPrice));
  }
  total = moneyAdd(total, costFromTokensPerMillion(usage.outputTokens, pricing.outputPrice));
  if (pricing.reasoningPrice && usage.reasoningTokens > 0) {
    total = moneyAdd(total, costFromTokensPerMillion(usage.reasoningTokens, pricing.reasoningPrice));
  }
  return total;
}

export async function calculateAiUsageCost(input: {
  provider: string;
  requestedModel: string;
  actualModel?: string | null;
  usage: LlmUsageDetails;
  at?: Date;
}): Promise<AiUsageCostBreakdown | null> {
  const model = (input.actualModel ?? input.requestedModel).trim();
  const pricing = await resolveActiveModelPricing({
    provider: input.provider,
    model,
    at: input.at,
  });
  if (!pricing) return null;

  const markupSettings = await getAiPlatformMarkupSettings();
  const markupPercent = resolveMarkupPercentForModel(markupSettings, model);
  const providerCost = calculateProviderCostFromPricing(pricing, input.usage);
  const platformCost = applyMarkup(providerCost, markupPercent);

  return {
    pricingVersionId: pricing.id,
    provider: pricing.provider,
    model: pricing.model,
    currency: pricing.currency,
    markupPercent,
    providerCost,
    platformCost,
  };
}

/** Estimativa conservadora para reserva preventiva (não é cobrança final). */
export async function estimateReservePlatformCost(input: {
  provider: string;
  model: string;
  maxTokens: number;
  at?: Date;
}): Promise<MoneyDecimal> {
  const pricing = await resolveActiveModelPricing({
    provider: input.provider,
    model: input.model,
    at: input.at,
  });
  if (!pricing) return money("0.10");

  const markupSettings = await getAiPlatformMarkupSettings();
  const markupPercent = resolveMarkupPercentForModel(markupSettings, input.model);
  const assumedInputTokens = 4_000;
  const assumedOutputTokens = Math.max(256, Math.min(input.maxTokens, 8192));
  const providerCost = calculateProviderCostFromPricing(pricing, {
    inputTokens: assumedInputTokens,
    cachedInputTokens: 0,
    outputTokens: assumedOutputTokens,
    reasoningTokens: 0,
  });
  const platformCost = applyMarkup(providerCost, markupPercent);
  return platformCost.mul(1.25);
}

export async function listActiveAiModelPricing() {
  const rows = await prisma.aiModelPricing.findMany({
    where: { active: true },
    orderBy: [{ provider: "asc" }, { model: "asc" }, { effectiveFrom: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    currency: row.currency,
    inputPrice: moneyToApiString(row.inputPrice),
    cachedInputPrice: row.cachedInputPrice ? moneyToApiString(row.cachedInputPrice) : null,
    outputPrice: moneyToApiString(row.outputPrice),
    reasoningPrice: row.reasoningPrice ? moneyToApiString(row.reasoningPrice) : null,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    active: row.active,
  }));
}

export async function createAiModelPricingVersion(input: {
  provider: string;
  model: string;
  currency?: string;
  inputPrice: string | number;
  cachedInputPrice?: string | number | null;
  outputPrice: string | number;
  reasoningPrice?: string | number | null;
  effectiveFrom?: Date;
}) {
  const provider = input.provider.trim().toLowerCase();
  const model = input.model.trim();
  const effectiveFrom = input.effectiveFrom ?? new Date();

  await prisma.aiModelPricing.updateMany({
    where: { provider, model, active: true },
    data: { active: false, effectiveUntil: effectiveFrom },
  });

  const row = await prisma.aiModelPricing.create({
    data: {
      provider,
      model,
      currency: input.currency?.trim().toUpperCase() || "USD",
      inputPrice: money(input.inputPrice),
      cachedInputPrice:
        input.cachedInputPrice != null && input.cachedInputPrice !== ""
          ? money(input.cachedInputPrice)
          : null,
      outputPrice: money(input.outputPrice),
      reasoningPrice:
        input.reasoningPrice != null && input.reasoningPrice !== ""
          ? money(input.reasoningPrice)
          : null,
      effectiveFrom,
      active: true,
    },
  });

  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    currency: row.currency,
    inputPrice: moneyToApiString(row.inputPrice),
    cachedInputPrice: row.cachedInputPrice ? moneyToApiString(row.cachedInputPrice) : null,
    outputPrice: moneyToApiString(row.outputPrice),
    reasoningPrice: row.reasoningPrice ? moneyToApiString(row.reasoningPrice) : null,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    active: row.active,
  };
}
