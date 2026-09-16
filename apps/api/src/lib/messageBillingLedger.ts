import type { MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { MessageCategory, MessagePolicyDecision } from "./messagePolicyEngine.js";

/**
 * Message Ledger (Cost Policy) — registo de metadados de cobrança por mensagem.
 *
 * IMPORTANTE (política vigente da Meta — https://business.whatsapp.com/products/platform-pricing/):
 * - a cobrança é baseada em mensagens ENTREGUES, não em mensagens enviadas;
 * - a categoria e o país/mercado do destinatário influenciam a tarifa;
 * - Service e Utility em resposta ao usuário têm tratamento gratuito na regra atual.
 * Todos os valores calculados aqui são ESTIMATIVA — nunca cobrança oficial.
 */

export type LedgerEntryInput = {
  organizationId: string;
  conversationId: string;
  contactId?: string | null;
  messageId?: string | null;
  providerMessageId?: string | null;
  channel: string;
  provider?: string | null;
  category: MessageCategory;
  templateId?: string | null;
  interactionNumber?: number | null;
  billingStatus: "SENT" | "DELIVERED" | "READ" | "FAILED" | "BLOCKED";
  policyDecision?: MessagePolicyDecision | null;
  policyReason?: string | null;
  /** Telefone do destinatário (para estimar preço pelo país conforme regra vigente). */
  recipientPhone?: string | null;
};

/**
 * Estimativa de custo pela tabela configurável `whatsapp_pricing_rules`.
 * O país é determinado pelo prefixo E.164 do destinatário (regra vigente da Meta usa o
 * mercado do número do destinatário, não o país da organização).
 */
export async function estimateWhatsappMessageCost(params: {
  organizationId: string;
  recipientPhone: string | null | undefined;
  category: MessageCategory;
  at?: Date;
}): Promise<{ estimatedCost: Prisma.Decimal | null; currency: string | null; pricingVersion: string | null }> {
  const none = { estimatedCost: null, currency: null, pricingVersion: null };
  if (params.category === "UNKNOWN") return none;
  const phone = (params.recipientPhone ?? "").replace(/[^0-9]/g, "");
  if (!phone) return none;
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
  if (rules.length === 0) return none;

  /** Prefixo mais longo que casa com o telefone (org override antes de regra global). */
  let best: (typeof rules)[number] | null = null;
  for (const rule of rules) {
    const cc = rule.countryCode.replace(/[^0-9]/g, "");
    if (!cc || !phone.startsWith(cc)) continue;
    if (
      !best ||
      cc.length > best.countryCode.replace(/[^0-9]/g, "").length ||
      (cc.length === best.countryCode.length && rule.organizationId && !best.organizationId)
    ) {
      best = rule;
    }
  }
  if (!best) return none;
  return { estimatedCost: best.price, currency: best.currency, pricingVersion: best.version ?? null };
}

/** Regista uma entrada no ledger (fire-and-forget nos pontos de envio; nunca quebra o atendimento). */
export async function recordMessageLedgerEntry(input: LedgerEntryInput): Promise<void> {
  try {
    const isWhatsapp = input.channel === "WHATSAPP";
    const cost = isWhatsapp
      ? await estimateWhatsappMessageCost({
          organizationId: input.organizationId,
          recipientPhone: input.recipientPhone,
          category: input.category,
        })
      : { estimatedCost: null, currency: null, pricingVersion: null };

    await prisma.messageBillingLedgerEntry.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        contactId: input.contactId ?? null,
        messageId: input.messageId ?? null,
        providerMessageId: input.providerMessageId ?? null,
        channel: input.channel,
        provider: input.provider ?? null,
        messageCategory: input.category,
        templateId: input.templateId ?? null,
        interactionNumber: input.interactionNumber ?? null,
        billingStatus: input.billingStatus,
        estimatedCost: cost.estimatedCost,
        currency: cost.currency,
        pricingVersion: cost.pricingVersion,
        policyDecision: input.policyDecision ?? null,
        policyReason: (input.policyReason ?? "").slice(0, 255) || null,
        ...(input.billingStatus === "FAILED" ? { failedAt: new Date() } : {}),
      },
    });
  } catch {
    /* ledger é observabilidade — nunca falha o envio */
  }
}

/**
 * Atualiza a entrada do ledger quando o provider confirma entrega/leitura/falha.
 * SENT ≠ DELIVERED: a cobrança da Meta considera a entrega real.
 */
export async function updateLedgerDeliveryStatus(params: {
  organizationId: string;
  providerMessageId: string;
  status: MessageStatus;
}): Promise<void> {
  try {
    const now = new Date();
    const data: Prisma.MessageBillingLedgerEntryUpdateManyMutationInput = {
      billingStatus: params.status,
    };
    if (params.status === "DELIVERED") data.deliveredAt = now;
    if (params.status === "READ") {
      data.readAt = now;
      /** READ implica entregue. */
      data.deliveredAt = now;
    }
    if (params.status === "FAILED") data.failedAt = now;
    await prisma.messageBillingLedgerEntry.updateMany({
      where: {
        organizationId: params.organizationId,
        providerMessageId: params.providerMessageId,
        /** Nunca regredir READ → DELIVERED. */
        ...(params.status === "DELIVERED" ? { readAt: null } : {}),
      },
      data,
    });
  } catch {
    /* observabilidade */
  }
}

/** Regista número da interação no ledger da mensagem (após incremento do Interaction Budget). */
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
