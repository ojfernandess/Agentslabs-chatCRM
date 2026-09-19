import { prisma } from "../../db.js";
import { getAiPlatformUsdBrlRate } from "../ai-billing/aiPlatformFxSettings.js";
import { money, moneyMul, moneySub, moneyToApiString } from "../ai-billing/money.js";

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Margem agregada da plataforma (Super Admin) — não altera resumo por cliente. */
export async function getOpenAiPlatformProfitability(input?: { from?: Date; to?: Date; openAiCostUsd?: number }) {
  const now = new Date();
  const from = input?.from ?? startOfUtcMonth(now);
  const to = input?.to ?? now;

  const [usageAgg, debitAgg, usdBrlRate] = await Promise.all([
    prisma.aiUsageRecord.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _sum: { providerCost: true, platformCost: true },
    }),
    prisma.aiWalletLedgerEntry.aggregate({
      where: { entryType: "USAGE_DEBIT", createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    getAiPlatformUsdBrlRate(),
  ]);

  const creditsConsumed = money(debitAgg._sum.amount ?? 0).abs();
  const creditsConsumedBrl = creditsConsumed;
  const internalProviderCostUsd = money(usageAgg._sum.providerCost ?? 0);
  const internalBilledUsd = money(usageAgg._sum.platformCost ?? 0);
  const openAiCostUsd = input?.openAiCostUsd ?? 0;
  const openAiCostBrl = moneyMul(money(openAiCostUsd), usdBrlRate);
  const marginBrl = moneySub(creditsConsumedBrl, openAiCostBrl);

  return {
    source: "platform" as const,
    period: { from: from.toISOString(), to: to.toISOString() },
    usdBrlRate,
    creditsConsumedBrl: moneyToApiString(creditsConsumedBrl),
    openAiCostUsd: openAiCostUsd.toFixed(6),
    openAiCostBrl: moneyToApiString(openAiCostBrl),
    marginBrl: moneyToApiString(marginBrl),
    internal: {
      providerCostUsd: moneyToApiString(internalProviderCostUsd),
      billedUsd: moneyToApiString(internalBilledUsd),
    },
  };
}

export function convertUsdToBrl(usd: number, rate: number): string {
  return moneyToApiString(moneyMul(money(usd), rate));
}
