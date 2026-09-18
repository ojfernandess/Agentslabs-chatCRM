import type { Prisma } from "@prisma/client";
import type { MetaWebhookPricing } from "../providers/types.js";
import type { MetaBillingPolicyPhase } from "./metaBillingPolicy.js";
import type { MessageCategory } from "./messagePolicyEngine.js";
/**
 * Contexto para estimativa de custo WhatsApp (Cost Policy).
 * Separado do Interaction Policy — não afecta Controle de atendimento.
 */
export type MessageCostContext = {
  organizationId: string;
  recipientPhone: string | null | undefined;
  category: MessageCategory;
  isTemplate: boolean;
  /** CSW aberta no envio; null quando não aplicável (Web Chat). */
  serviceWindowOpenAtSend: boolean | null;
  metaPricing?: MetaWebhookPricing | null;
  at?: Date;
  /** Fase de política Meta vigente (Out/2026+ muda gratuidade in-window). */
  billingPolicyPhase?: Pick<
    MetaBillingPolicyPhase,
    "serviceInWindowFree" | "utilityInWindowFree"
  > | null;
};

export type ResolvedMessageCost = {
  metaBillable: boolean;
  estimatedCost: Prisma.Decimal | null;
  currency: string | null;
  pricingVersion: string | null;
};

export type PricingRuleMatch = {
  price: Prisma.Decimal;
  currency: string;
  version: string | null;
};

function normalizeMetaCategory(raw: string | null | undefined): MessageCategory | null {
  const c = (raw ?? "").trim().toUpperCase();
  if (c === "UTILITY" || c === "MARKETING" || c === "AUTHENTICATION" || c === "SERVICE") return c;
  return null;
}

/**
 * Determina se a Meta cobraria esta mensagem entregue.
 * Prioridade: webhook `pricing.billable` > fase de política > regras por categoria.
 */
export function resolveMetaBillable(ctx: MessageCostContext): boolean {
  if (ctx.metaPricing != null && typeof ctx.metaPricing.billable === "boolean") {
    return ctx.metaPricing.billable;
  }

  const phase = ctx.billingPolicyPhase;
  const serviceInWindowFree = phase?.serviceInWindowFree ?? true;
  const utilityInWindowFree = phase?.utilityInWindowFree ?? true;

  const category = ctx.metaPricing?.category
    ? (normalizeMetaCategory(ctx.metaPricing.category) ?? ctx.category)
    : ctx.category;

  if (category === "UNKNOWN") return false;
  if (category === "MARKETING" || category === "AUTHENTICATION") return true;

  if (category === "SERVICE") {
    if (ctx.isTemplate) return true;
    if (ctx.serviceWindowOpenAtSend === true) return !serviceInWindowFree;
    return true;
  }

  if (category === "UTILITY") {
    if (ctx.isTemplate && ctx.serviceWindowOpenAtSend === true) return !utilityInWindowFree;
    return true;
  }

  return false;
}

/** Aplica tarifa da tabela configurável quando a mensagem é cobrável. */
export function applyPricingRule(
  billable: boolean,
  category: MessageCategory,
  rule: PricingRuleMatch | null,
): Omit<ResolvedMessageCost, "metaBillable"> {
  if (!billable) {
    return { estimatedCost: null, currency: null, pricingVersion: null };
  }
  if (category === "UNKNOWN" || !rule) {
    return { estimatedCost: null, currency: null, pricingVersion: null };
  }
  return {
    estimatedCost: rule.price,
    currency: rule.currency,
    pricingVersion: rule.version,
  };
}

/** Custo zero explícito para mensagens entregues mas não cobráveis pela Meta. */
export function zeroCost(): Omit<ResolvedMessageCost, "metaBillable"> {
  return { estimatedCost: null, currency: null, pricingVersion: null };
}

export function resolveMessageCost(
  ctx: MessageCostContext,
  rule: PricingRuleMatch | null,
): ResolvedMessageCost {
  const metaBillable = resolveMetaBillable(ctx);
  if (!metaBillable) {
    return { metaBillable: false, ...zeroCost() };
  }
  const category =
    (ctx.metaPricing?.category ? normalizeMetaCategory(ctx.metaPricing.category) : null) ??
    ctx.category;
  return { metaBillable: true, ...applyPricingRule(true, category, rule) };
}

/** Seleciona a melhor regra por prefixo E.164 (org override > global). */
export function pickBestPricingRule<
  T extends {
    countryCode: string;
    organizationId: string | null;
    price: Prisma.Decimal;
    currency: string;
    version: string | null;
  },
>(rules: T[], phoneDigits: string): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    const cc = rule.countryCode.replace(/[^0-9]/g, "");
    if (!cc || !phoneDigits.startsWith(cc)) continue;
    if (
      !best ||
      cc.length > best.countryCode.replace(/[^0-9]/g, "").length ||
      (cc.length === best.countryCode.replace(/[^0-9]/g, "").length &&
        rule.organizationId &&
        !best.organizationId)
    ) {
      best = rule;
    }
  }
  return best;
}

export function parseMetaWebhookPricing(raw: unknown): MetaWebhookPricing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.billable !== "boolean") return undefined;
  return {
    billable: o.billable,
    pricingModel: typeof o.pricing_model === "string" ? o.pricing_model : null,
    type: typeof o.type === "string" ? o.type : null,
    category: typeof o.category === "string" ? o.category : null,
  };
}
