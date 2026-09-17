import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  money,
  moneyAdd,
  moneyGte,
  moneySub,
  moneyToApiString,
  moneyZero,
  type MoneyDecimal,
} from "./money.js";

export type AiWalletSnapshot = {
  organizationId: string;
  balance: MoneyDecimal;
  reservedBalance: MoneyDecimal;
  availableBalance: MoneyDecimal;
  currency: string;
};

export class AiWalletError extends Error {
  constructor(
    message: string,
    readonly code: "insufficient_balance" | "wallet_not_found" | "duplicate_operation",
  ) {
    super(message);
    this.name = "AiWalletError";
  }
}

function availableBalance(balance: MoneyDecimal, reserved: MoneyDecimal): MoneyDecimal {
  return moneySub(balance, reserved);
}

export async function getOrCreateAiWallet(organizationId: string): Promise<AiWalletSnapshot> {
  const row = await prisma.organizationAiWallet.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
  const balance = money(row.balance);
  const reservedBalance = money(row.reservedBalance);
  return {
    organizationId,
    balance,
    reservedBalance,
    availableBalance: availableBalance(balance, reservedBalance),
    currency: row.currency,
  };
}

export async function creditAiWallet(input: {
  organizationId: string;
  amount: MoneyDecimal;
  entryType: "CREDIT_ADJUSTMENT" | "CREDIT_PURCHASE" | "REFUND";
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AiWalletSnapshot> {
  if (!moneyGte(input.amount, moneyZero()) || input.amount.equals(0)) {
    throw new AiWalletError("Credit amount must be positive", "insufficient_balance");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.aiWalletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const wallet = await tx.organizationAiWallet.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
      const balance = money(wallet.balance);
      const reservedBalance = money(wallet.reservedBalance);
      return {
        organizationId: input.organizationId,
        balance,
        reservedBalance,
        availableBalance: availableBalance(balance, reservedBalance),
        currency: wallet.currency,
      };
    }

    const wallet = await tx.organizationAiWallet.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId },
      update: {},
    });

    const balance = moneyAdd(money(wallet.balance), input.amount);
    const reservedBalance = money(wallet.reservedBalance);

    await tx.organizationAiWallet.update({
      where: { organizationId: input.organizationId },
      data: { balance },
    });

    await tx.aiWalletLedgerEntry.create({
      data: {
        organizationId: input.organizationId,
        entryType: input.entryType,
        amount: input.amount,
        balanceAfter: balance,
        reservedAfter: reservedBalance,
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });

    return {
      organizationId: input.organizationId,
      balance,
      reservedBalance,
      availableBalance: availableBalance(balance, reservedBalance),
      currency: wallet.currency,
    };
  });
}

export async function reserveAiWalletBalance(input: {
  organizationId: string;
  amount: MoneyDecimal;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<AiWalletSnapshot> {
  if (!moneyGte(input.amount, moneyZero()) || input.amount.equals(0)) {
    throw new AiWalletError("Reserve amount must be positive", "insufficient_balance");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.aiWalletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const wallet = await tx.organizationAiWallet.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
      const balance = money(wallet.balance);
      const reservedBalance = money(wallet.reservedBalance);
      return {
        organizationId: input.organizationId,
        balance,
        reservedBalance,
        availableBalance: availableBalance(balance, reservedBalance),
        currency: wallet.currency,
      };
    }

    const wallet = await tx.organizationAiWallet.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId },
      update: {},
    });

    const balance = money(wallet.balance);
    const reservedBalance = moneyAdd(money(wallet.reservedBalance), input.amount);
    const available = availableBalance(balance, reservedBalance);
    if (available.lessThan(0)) {
      throw new AiWalletError("Insufficient AI credits balance", "insufficient_balance");
    }

    await tx.organizationAiWallet.update({
      where: { organizationId: input.organizationId },
      data: { reservedBalance },
    });

    await tx.aiWalletLedgerEntry.create({
      data: {
        organizationId: input.organizationId,
        entryType: "RESERVE_HOLD",
        amount: input.amount,
        balanceAfter: balance,
        reservedAfter: reservedBalance,
        idempotencyKey: input.idempotencyKey,
        referenceType: "ai_usage_session",
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });

    return {
      organizationId: input.organizationId,
      balance,
      reservedBalance,
      availableBalance: available,
      currency: wallet.currency,
    };
  });
}

export async function releaseAiWalletReserve(input: {
  organizationId: string;
  amount: MoneyDecimal;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!moneyGte(input.amount, moneyZero()) || input.amount.equals(0)) return;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.aiWalletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return;

    const wallet = await tx.organizationAiWallet.findUnique({
      where: { organizationId: input.organizationId },
    });
    if (!wallet) return;

    const balance = money(wallet.balance);
    const reservedBalance = moneySub(money(wallet.reservedBalance), input.amount);
    const nextReserved = reservedBalance.lessThan(0) ? moneyZero() : reservedBalance;

    await tx.organizationAiWallet.update({
      where: { organizationId: input.organizationId },
      data: { reservedBalance: nextReserved },
    });

    await tx.aiWalletLedgerEntry.create({
      data: {
        organizationId: input.organizationId,
        entryType: "RESERVE_RELEASE",
        amount: money(input.amount).mul(-1),
        balanceAfter: balance,
        reservedAfter: nextReserved,
        idempotencyKey: input.idempotencyKey,
        referenceType: "ai_usage_session",
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  });
}

export function serializeAiWalletSnapshot(snapshot: AiWalletSnapshot) {
  return {
    organizationId: snapshot.organizationId,
    balance: moneyToApiString(snapshot.balance),
    reservedBalance: moneyToApiString(snapshot.reservedBalance),
    availableBalance: moneyToApiString(snapshot.availableBalance),
    currency: snapshot.currency,
  };
}
