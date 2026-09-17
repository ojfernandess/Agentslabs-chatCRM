import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMarkup, resolveMarkupPercentForModel } from "./aiPlatformMarkupSettings.js";
import { calculateProviderCostFromPricing } from "./AiPricingService.js";
import { money, moneyToApiString } from "./money.js";

describe("AiPricingService", () => {
  it("calculateProviderCostFromPricing sums token buckets", () => {
    const cost = calculateProviderCostFromPricing(
      {
        inputPrice: money("0.15"),
        cachedInputPrice: money("0.075"),
        outputPrice: money("0.60"),
        reasoningPrice: money("0.30"),
      },
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 250_000,
        reasoningTokens: 100_000,
      },
    );

    assert.equal(moneyToApiString(cost), "0.36750000");
  });

  it("applyMarkup adds configured percent", () => {
    const providerCost = money("1.00");
    const platformCost = applyMarkup(providerCost, 20);
    assert.equal(moneyToApiString(platformCost), "1.20000000");
  });

  it("resolveMarkupPercentForModel prefers model-specific markup", () => {
    const percent = resolveMarkupPercentForModel(
      { globalMarkupPercent: 10, modelMarkupPercent: { "gpt-4o-mini": 25 } },
      "gpt-4o-mini",
    );
    assert.equal(percent, 25);
  });
});
