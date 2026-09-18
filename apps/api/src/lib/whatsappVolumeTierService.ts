import type { MessageCategory } from "./messagePolicyEngine.js";
import { prisma } from "../db.js";
import {
  applyVolumeTierDiscount,
  calendarMonthBounds,
  pickVolumeTierForMessageIndex,
  type VolumeTierDef,
} from "./whatsappVolumeTier.js";

export async function loadVolumeTiers(params: {
  organizationId: string;
  countryCode: string;
  category: MessageCategory;
  currency: string;
  version: string | null;
  at: Date;
}): Promise<VolumeTierDef[]> {
  if (params.category !== "UTILITY" && params.category !== "AUTHENTICATION") return [];
  const rows = await prisma.whatsappPricingVolumeTier.findMany({
    where: {
      countryCode: params.countryCode,
      category: params.category,
      currency: params.currency,
      effectiveFrom: { lte: params.at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: params.at } }],
      AND: [{ OR: [{ organizationId: params.organizationId }, { organizationId: null }] }],
      ...(params.version ? { version: params.version } : {}),
    },
    orderBy: [{ organizationId: { sort: "desc", nulls: "last" } }, { fromMessage: "asc" }],
    take: 50,
  });
  if (rows.length === 0) return [];
  return rows.map((r) => ({
    fromMessage: r.fromMessage,
    toMessage: r.toMessage,
    discountPercent: Number(r.discountPercent),
  }));
}

/** Conta mensagens cobráveis entregues no mês (Utility/Auth) antes desta mensagem. */
export async function countPriorBillableVolumeMessages(params: {
  organizationId: string;
  countryCode: string;
  category: MessageCategory;
  market: string;
  at: Date;
  excludeLedgerId?: string;
}): Promise<number> {
  const { from, to } = calendarMonthBounds(params.at);
  return prisma.messageBillingLedgerEntry.count({
    where: {
      organizationId: params.organizationId,
      channel: "WHATSAPP",
      messageCategory: params.category,
      market: params.market,
      billingStatus: { in: ["DELIVERED", "READ"] },
      metaBillable: true,
      deliveredAt: { gte: from, lte: to },
      ...(params.excludeLedgerId ? { id: { not: params.excludeLedgerId } } : {}),
    },
  });
}

/** Conta mensagens Service entregues no mês por caixa (franquia Meta por número business). */
export async function countPriorServiceMessagesThisMonth(params: {
  organizationId: string;
  inboxId: string | null;
  at: Date;
  excludeLedgerId?: string;
}): Promise<number> {
  if (!params.inboxId) return 0;
  const { from, to } = calendarMonthBounds(params.at);
  return prisma.messageBillingLedgerEntry.count({
    where: {
      organizationId: params.organizationId,
      channel: "WHATSAPP",
      inboxId: params.inboxId,
      messageCategory: "SERVICE",
      billingStatus: { in: ["DELIVERED", "READ"] },
      deliveredAt: { gte: from, lte: to },
      ...(params.excludeLedgerId ? { id: { not: params.excludeLedgerId } } : {}),
    },
  });
}

export async function resolveVolumeTierDiscount(params: {
  organizationId: string;
  countryCode: string;
  category: MessageCategory;
  currency: string;
  version: string | null;
  market: string;
  at: Date;
  excludeLedgerId?: string;
}): Promise<{ discountPercent: number; messageIndex: number } | null> {
  if (params.category !== "UTILITY" && params.category !== "AUTHENTICATION") return null;
  const tiers = await loadVolumeTiers(params);
  if (tiers.length === 0) return null;
  const prior = await countPriorBillableVolumeMessages({
    organizationId: params.organizationId,
    countryCode: params.countryCode,
    category: params.category,
    market: params.market,
    at: params.at,
    excludeLedgerId: params.excludeLedgerId,
  });
  const messageIndex = prior + 1;
  const tier = pickVolumeTierForMessageIndex(tiers, messageIndex);
  if (!tier) return { discountPercent: 0, messageIndex };
  return { discountPercent: tier.discountPercent, messageIndex };
}

export { applyVolumeTierDiscount, pickVolumeTierForMessageIndex };
