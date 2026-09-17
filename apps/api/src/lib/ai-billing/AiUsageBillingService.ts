import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { calculateAiUsageCost, estimateReservePlatformCost } from "./AiPricingService.js";
import {
  AiWalletError,
  getOrCreateAiWallet,
  releaseAiWalletReserve,
  reserveAiWalletBalance,
  serializeAiWalletSnapshot,
} from "./AiWalletService.js";
import { getOrganizationAiBillingMode } from "./getOrganizationAiBillingMode.js";
import { mergeLlmUsageDetails, type LlmUsageDetails } from "./llmUsageDetails.js";
import { money, moneySub, moneyToApiString, moneyZero, type MoneyDecimal } from "./money.js";

export type PlatformCreditsBillingHandle =
  | { ok: false; reason: "insufficient_balance" | "not_platform_credits" }
  | {
      ok: true;
      sessionId: string;
      organizationId: string;
      reserveAmount: MoneyDecimal;
      reserveIdempotencyKey: string;
      releaseIdempotencyKey: string;
      debitIdempotencyKey: string;
      provider: string;
      requestedModel: string;
    };

export async function getOrganizationAiCreditsBalance(organizationId: string) {
  const mode = await getOrganizationAiBillingMode(organizationId);
  const wallet = await getOrCreateAiWallet(organizationId);
  return {
    aiBillingMode: mode,
    wallet: serializeAiWalletSnapshot(wallet),
  };
}

export async function beginPlatformCreditsLlmUsage(input: {
  organizationId: string;
  provider: string;
  requestedModel: string;
  maxTokens: number;
  agentBotId?: string | null;
  conversationId?: string | null;
}): Promise<PlatformCreditsBillingHandle> {
  const mode = await getOrganizationAiBillingMode(input.organizationId);
  if (mode !== "PLATFORM_CREDITS") {
    return { ok: false, reason: "not_platform_credits" };
  }

  const sessionId = randomUUID();
  const reserveAmount = await estimateReservePlatformCost({
    provider: input.provider,
    model: input.requestedModel,
    maxTokens: input.maxTokens,
  });

  const reserveIdempotencyKey = `ai-reserve:${sessionId}`;
  try {
    await reserveAiWalletBalance({
      organizationId: input.organizationId,
      amount: reserveAmount,
      idempotencyKey: reserveIdempotencyKey,
      metadata: {
        sessionId,
        provider: input.provider,
        requestedModel: input.requestedModel,
        agentBotId: input.agentBotId ?? null,
        conversationId: input.conversationId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof AiWalletError && err.code === "insufficient_balance") {
      return { ok: false, reason: "insufficient_balance" };
    }
    throw err;
  }

  return {
    ok: true,
    sessionId,
    organizationId: input.organizationId,
    reserveAmount,
    reserveIdempotencyKey,
    releaseIdempotencyKey: `ai-release:${sessionId}`,
    debitIdempotencyKey: `ai-debit:${sessionId}`,
    provider: input.provider,
    requestedModel: input.requestedModel,
  };
}

export async function finalizePlatformCreditsLlmUsage(input: {
  handle: PlatformCreditsBillingHandle & { ok: true };
  usageParts: LlmUsageDetails[];
  agentBotId?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  const usage = mergeLlmUsageDetails(input.usageParts);
  if (usage.totalTokens <= 0) {
    await cancelPlatformCreditsLlmUsage(input.handle);
    return;
  }

  const cost = await calculateAiUsageCost({
    provider: input.handle.provider,
    requestedModel: input.handle.requestedModel,
    actualModel: usage.actualModel ?? input.handle.requestedModel,
    usage,
  });
  if (!cost) {
    await cancelPlatformCreditsLlmUsage(input.handle);
    return;
  }

  const usageIdempotencyKey =
    usage.requestId != null && usage.requestId.trim()
      ? `ai-usage:${input.handle.organizationId}:${usage.requestId.trim()}`
      : input.handle.debitIdempotencyKey;

  await prisma.$transaction(async (tx) => {
    const existingUsage = await tx.aiUsageRecord.findUnique({
      where: { idempotencyKey: usageIdempotencyKey },
    });
    if (existingUsage) return;

    const wallet = await tx.organizationAiWallet.findUnique({
      where: { organizationId: input.handle.organizationId },
    });
    if (!wallet) return;

    const balanceBefore = money(wallet.balance);
    const reservedBefore = money(wallet.reservedBalance);
    const platformCost = cost.platformCost;
    const nextBalance = moneySub(balanceBefore, platformCost);
    const nextReserved = moneySub(reservedBefore, input.handle.reserveAmount);
    const reservedAfter = nextReserved.lessThan(0) ? moneyZero() : nextReserved;

    await tx.organizationAiWallet.update({
      where: { organizationId: input.handle.organizationId },
      data: {
        balance: nextBalance,
        reservedBalance: reservedAfter,
      },
    });

    await tx.aiWalletLedgerEntry.create({
      data: {
        organizationId: input.handle.organizationId,
        entryType: "USAGE_DEBIT",
        amount: platformCost.mul(-1),
        balanceAfter: nextBalance,
        reservedAfter,
        idempotencyKey: input.handle.debitIdempotencyKey,
        referenceType: "ai_usage_record",
        referenceId: usageIdempotencyKey,
        metadata: {
          sessionId: input.handle.sessionId,
          providerCost: moneyToApiString(cost.providerCost),
          platformCost: moneyToApiString(platformCost),
          reserveAmount: moneyToApiString(input.handle.reserveAmount),
        },
      },
    });

    await tx.aiUsageRecord.create({
      data: {
        organizationId: input.handle.organizationId,
        agentBotId: input.agentBotId ?? null,
        conversationId: input.conversationId ?? null,
        provider: cost.provider,
        requestedModel: input.handle.requestedModel,
        actualModel: usage.actualModel ?? input.handle.requestedModel,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        totalTokens: usage.totalTokens,
        providerCost: cost.providerCost,
        markupPercent: cost.markupPercent,
        platformCost,
        pricingVersionId: cost.pricingVersionId,
        openaiRequestId: usage.requestId ?? null,
        idempotencyKey: usageIdempotencyKey,
        usageMetadata: {
          sessionId: input.handle.sessionId,
          reserveAmount: moneyToApiString(input.handle.reserveAmount),
        } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function cancelPlatformCreditsLlmUsage(
  handle: PlatformCreditsBillingHandle & { ok: true },
): Promise<void> {
  await releaseAiWalletReserve({
    organizationId: handle.organizationId,
    amount: handle.reserveAmount,
    idempotencyKey: handle.releaseIdempotencyKey,
    metadata: { sessionId: handle.sessionId },
  });
}

export async function listOrganizationAiUsageRecords(organizationId: string, limit = 24) {
  const rows = await prisma.aiUsageRecord.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      provider: true,
      requestedModel: true,
      actualModel: true,
      inputTokens: true,
      cachedInputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      totalTokens: true,
      providerCost: true,
      markupPercent: true,
      platformCost: true,
      openaiRequestId: true,
      createdAt: true,
      pricingVersion: { select: { id: true, currency: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    requestedModel: row.requestedModel,
    actualModel: row.actualModel,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    totalTokens: row.totalTokens,
    providerCost: moneyToApiString(row.providerCost),
    markupPercent: row.markupPercent.toNumber(),
    platformCost: moneyToApiString(row.platformCost),
    currency: row.pricingVersion.currency,
    pricingVersionId: row.pricingVersion.id,
    openaiRequestId: row.openaiRequestId,
    createdAt: row.createdAt.toISOString(),
  }));
}
