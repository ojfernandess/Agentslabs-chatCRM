import type { MessageStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { MetaWebhookPricing } from "../providers/types.js";
import type { MessageCategory, MessagePolicyDecision } from "./messagePolicyEngine.js";
import { getActiveBillingPolicyPhase } from "./metaBillingPolicy.js";
import {
  pickBestPricingRule,
  resolveMessageCost,
  type MessageCostContext,
} from "./whatsappMessageCost.js";
import {
  applyVolumeTierDiscount,
  resolveCountryCodeFromPhone,
  resolveMarketFromCountryCode,
} from "./whatsappVolumeTier.js";
import {
  countPriorServiceMessagesThisMonth,
  resolveVolumeTierDiscount,
} from "./whatsappVolumeTierService.js";

/**
 * Message Ledger (Cost Policy) — registo de metadados de cobrança por mensagem.
 *
 * NÃO altera Interaction Policy (Controle de atendimento).
 */

export type LedgerEntryInput = {
  organizationId: string;
  conversationId: string;
  contactId?: string | null;
  messageId?: string | null;
  providerMessageId?: string | null;
  inboxId?: string | null;
  channel: string;
  provider?: string | null;
  category: MessageCategory;
  templateId?: string | null;
  isTemplate?: boolean;
  serviceWindowOpenAtSend?: boolean | null;
  interactionNumber?: number | null;
  billingStatus: "SENT" | "DELIVERED" | "READ" | "FAILED" | "BLOCKED";
  policyDecision?: MessagePolicyDecision | null;
  policyReason?: string | null;
  recipientPhone?: string | null;
};

type DeliveredCostResult = {
  metaBillable: boolean;
  estimatedCost: Prisma.Decimal | null;
  currency: string | null;
  pricingVersion: string | null;
  metaPricingType: string | null;
  metaPricingCategory: string | null;
  metaPricingModel: string | null;
  market: string | null;
  listUnitPrice: Prisma.Decimal | null;
  volumeTierDiscountPercent: Prisma.Decimal | null;
  serviceFreeTierApplied: boolean;
};

async function lookupPricingRule(params: {
  organizationId: string;
  recipientPhone: string | null | undefined;
  category: MessageCategory;
  at?: Date;
}): Promise<{ price: Prisma.Decimal; currency: string; version: string | null; market: string } | null> {
  if (params.category === "UNKNOWN") return null;
  const phone = (params.recipientPhone ?? "").replace(/[^0-9]/g, "");
  if (!phone) return null;
  const at = params.at ?? new Date();

  const rules = await prisma.whatsappPricingRule.findMany({
    where: {
      category: params.category,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
      AND: [{ OR: [{ organizationId: params.organizationId }, { organizationId: null }] }],
    },
    orderBy: [{ organizationId: { sort: "desc", nulls: "last" } }, { effectiveFrom: "desc" }],
    take: 200,
  });
  const best = pickBestPricingRule(rules, phone);
  if (!best) return null;
  return {
    price: best.price,
    currency: best.currency,
    version: best.version ?? null,
    market: best.market,
  };
}

function buildCostContextFromLedger(
  entry: {
    organizationId: string;
    messageCategory: string;
    templateId: string | null;
    recipientPhone: string | null;
    serviceWindowOpenAtSend: boolean | null;
    inboxId: string | null;
    market: string | null;
  },
  metaPricing?: MetaWebhookPricing | null,
  at?: Date,
): MessageCostContext {
  return {
    organizationId: entry.organizationId,
    recipientPhone: entry.recipientPhone,
    category: entry.messageCategory as MessageCategory,
    isTemplate: Boolean(entry.templateId),
    serviceWindowOpenAtSend: entry.serviceWindowOpenAtSend,
    metaPricing,
    at,
  };
}

async function computeDeliveredCost(
  entry: {
    id: string;
    organizationId: string;
    messageCategory: string;
    templateId: string | null;
    recipientPhone: string | null;
    serviceWindowOpenAtSend: boolean | null;
    inboxId: string | null;
    market: string | null;
  },
  metaPricing?: MetaWebhookPricing | null,
  at?: Date,
): Promise<DeliveredCostResult> {
  const deliveredAt = at ?? new Date();
  const phase = await getActiveBillingPolicyPhase(deliveredAt);
  const ctx = buildCostContextFromLedger(entry, metaPricing, deliveredAt);
  ctx.billingPolicyPhase = {
    serviceInWindowFree: phase.serviceInWindowFree,
    utilityInWindowFree: phase.utilityInWindowFree,
  };

  const categoryForLookup = (ctx.metaPricing?.category ?? ctx.category).toUpperCase() as MessageCategory;
  const rule = await lookupPricingRule({
    organizationId: ctx.organizationId,
    recipientPhone: ctx.recipientPhone,
    category: categoryForLookup,
    at: deliveredAt,
  });

  const base = resolveMessageCost(ctx, rule ? { price: rule.price, currency: rule.currency, version: rule.version } : null);
  const countryCodeDigits = resolveCountryCodeFromPhone(entry.recipientPhone);
  const market =
    entry.market ??
    rule?.market ??
    (countryCodeDigits ? resolveMarketFromCountryCode(countryCodeDigits) : null);

  const emptyExtras = {
    metaPricingType: metaPricing?.type ?? null,
    metaPricingCategory: metaPricing?.category ?? null,
    metaPricingModel: metaPricing?.pricingModel ?? null,
    market,
    listUnitPrice: null as Prisma.Decimal | null,
    volumeTierDiscountPercent: null as Prisma.Decimal | null,
    serviceFreeTierApplied: false,
  };

  if (!base.metaBillable || !rule) {
    return { ...base, ...emptyExtras };
  }

  let estimatedCost: Prisma.Decimal | null = rule.price;
  let listUnitPrice: Prisma.Decimal | null = rule.price;
  let volumeTierDiscountPercent: Prisma.Decimal | null = null;
  let serviceFreeTierApplied = false;
  let metaBillable = true;

  if (
    (categoryForLookup === "UTILITY" || categoryForLookup === "AUTHENTICATION") &&
    countryCodeDigits &&
    market
  ) {
    const vol = await resolveVolumeTierDiscount({
      organizationId: entry.organizationId,
      countryCode: countryCodeDigits,
      category: categoryForLookup,
      currency: rule.currency,
      version: rule.version,
      market,
      at: deliveredAt,
      excludeLedgerId: entry.id,
    });
    if (vol && vol.discountPercent > 0) {
      volumeTierDiscountPercent = new Prisma.Decimal(vol.discountPercent);
      estimatedCost = applyVolumeTierDiscount(rule.price, vol.discountPercent);
    }
  }

  if (
    categoryForLookup === "SERVICE" &&
    phase.serviceFreeTierPerNumberPerMonth != null &&
    phase.serviceFreeTierPerNumberPerMonth > 0
  ) {
    const priorService = await countPriorServiceMessagesThisMonth({
      organizationId: entry.organizationId,
      inboxId: entry.inboxId,
      at: deliveredAt,
      excludeLedgerId: entry.id,
    });
    if (priorService < phase.serviceFreeTierPerNumberPerMonth) {
      serviceFreeTierApplied = true;
      metaBillable = false;
      estimatedCost = null;
      listUnitPrice = null;
      volumeTierDiscountPercent = null;
    }
  }

  return {
    metaBillable,
    estimatedCost,
    currency: metaBillable ? rule.currency : null,
    pricingVersion: rule.version,
    ...emptyExtras,
    listUnitPrice,
    volumeTierDiscountPercent,
    serviceFreeTierApplied,
  };
}

function ledgerBaseData(input: LedgerEntryInput) {
  const phone = (input.recipientPhone ?? "").replace(/[^+0-9]/g, "") || null;
  const cc = resolveCountryCodeFromPhone(phone);
  return {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    contactId: input.contactId ?? null,
    inboxId: input.inboxId ?? null,
    providerMessageId: input.providerMessageId ?? null,
    channel: input.channel,
    provider: input.provider ?? null,
    messageCategory: input.category,
    templateId: input.templateId ?? null,
    recipientPhone: phone,
    market: cc ? resolveMarketFromCountryCode(cc) : null,
    serviceWindowOpenAtSend: input.serviceWindowOpenAtSend ?? null,
    interactionNumber: input.interactionNumber ?? null,
    billingStatus: input.billingStatus,
    policyDecision: input.policyDecision ?? null,
    policyReason: (input.policyReason ?? "").slice(0, 255) || null,
    ...(input.billingStatus === "FAILED" ? { failedAt: new Date() } : {}),
  };
}

/** Regista uma entrada no ledger (fire-and-forget; nunca quebra o atendimento). */
export async function recordMessageLedgerEntry(input: LedgerEntryInput): Promise<void> {
  try {
    const isWhatsapp = input.channel === "WHATSAPP";
    const base = ledgerBaseData(input);

    const data = {
      ...base,
      estimatedCost: null,
      currency: null,
      pricingVersion: null,
      metaBillable: null,
      metaPricingType: null,
      metaPricingCategory: null,
      metaPricingModel: null,
      listUnitPrice: null,
      volumeTierDiscountPercent: null,
      serviceFreeTierApplied: false,
    };

    if (!isWhatsapp) {
      await prisma.messageBillingLedgerEntry.create({ data });
      return;
    }

    if (input.messageId) {
      await prisma.messageBillingLedgerEntry.upsert({
        where: { messageId: input.messageId },
        create: { ...data, messageId: input.messageId },
        update: {
          providerMessageId: input.providerMessageId ?? undefined,
          inboxId: input.inboxId ?? undefined,
          market: base.market ?? undefined,
          billingStatus: input.billingStatus,
          policyDecision: input.policyDecision ?? undefined,
          policyReason: base.policyReason ?? undefined,
          recipientPhone: base.recipientPhone ?? undefined,
          serviceWindowOpenAtSend: input.serviceWindowOpenAtSend ?? undefined,
        },
      });
      return;
    }

    await prisma.messageBillingLedgerEntry.create({ data });
  } catch {
    /* ledger é observabilidade — nunca falha o envio */
  }
}

export async function updateLedgerDeliveryStatus(params: {
  organizationId: string;
  providerMessageId: string;
  status: MessageStatus;
  metaPricing?: MetaWebhookPricing | null;
}): Promise<void> {
  try {
    const now = new Date();
    const entries = await prisma.messageBillingLedgerEntry.findMany({
      where: {
        organizationId: params.organizationId,
        providerMessageId: params.providerMessageId,
        channel: "WHATSAPP",
      },
      take: 5,
    });
    if (entries.length === 0) return;

    for (const entry of entries) {
      const statusData: Prisma.MessageBillingLedgerEntryUpdateInput = {
        billingStatus: params.status,
      };

      if (params.status === "DELIVERED") {
        statusData.deliveredAt = now;
      }
      if (params.status === "READ") {
        statusData.readAt = now;
        statusData.deliveredAt = entry.deliveredAt ?? now;
      }
      if (params.status === "FAILED") {
        statusData.failedAt = now;
        statusData.estimatedCost = null;
        statusData.currency = null;
        statusData.pricingVersion = null;
        statusData.metaBillable = false;
        statusData.listUnitPrice = null;
        statusData.volumeTierDiscountPercent = null;
        statusData.serviceFreeTierApplied = false;
      }

      if (params.status === "DELIVERED" || params.status === "READ") {
        const cost = await computeDeliveredCost(entry, params.metaPricing, now);
        statusData.metaBillable = cost.metaBillable;
        statusData.estimatedCost = cost.estimatedCost;
        statusData.currency = cost.currency;
        statusData.pricingVersion = cost.pricingVersion;
        statusData.metaPricingType = cost.metaPricingType;
        statusData.metaPricingCategory = cost.metaPricingCategory;
        statusData.metaPricingModel = cost.metaPricingModel;
        statusData.market = cost.market;
        statusData.listUnitPrice = cost.listUnitPrice;
        statusData.volumeTierDiscountPercent = cost.volumeTierDiscountPercent;
        statusData.serviceFreeTierApplied = cost.serviceFreeTierApplied;
      }

      await prisma.messageBillingLedgerEntry.updateMany({
        where: {
          id: entry.id,
          ...(params.status === "DELIVERED" ? { readAt: null } : {}),
        },
        data: statusData,
      });
    }
  } catch {
    /* observabilidade */
  }
}

export async function attachInteractionNumberToLedger(params: {
  messageId: string;
  interactionNumber: number;
}): Promise<void> {
  await prisma.messageBillingLedgerEntry
    .updateMany({
      where: { messageId: params.messageId },
      data: { interactionNumber: params.interactionNumber },
    })
    .catch(() => {});
}

export async function estimateWhatsappMessageCost(params: {
  organizationId: string;
  recipientPhone: string | null | undefined;
  category: MessageCategory;
  at?: Date;
  isTemplate?: boolean;
  serviceWindowOpenAtSend?: boolean | null;
  metaPricing?: MetaWebhookPricing | null;
  inboxId?: string | null;
}): Promise<{ estimatedCost: Prisma.Decimal | null; currency: string | null; pricingVersion: string | null }> {
  const at = params.at ?? new Date();
  const fakeEntry = {
    id: "estimate",
    organizationId: params.organizationId,
    messageCategory: params.category,
    templateId: params.isTemplate ? "tpl" : null,
    recipientPhone: params.recipientPhone ?? null,
    serviceWindowOpenAtSend: params.serviceWindowOpenAtSend ?? null,
    inboxId: params.inboxId ?? null,
    market: null as string | null,
  };
  const cost = await computeDeliveredCost(fakeEntry, params.metaPricing, at);
  return {
    estimatedCost: cost.estimatedCost,
    currency: cost.currency,
    pricingVersion: cost.pricingVersion,
  };
}
