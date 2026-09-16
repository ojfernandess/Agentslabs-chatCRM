import { prisma } from "../db.js";
import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";

/**
 * Message Policy Engine — decide SE e COMO uma mensagem pode ser enviada pelo canal.
 *
 * Separação de responsabilidades (spec §36):
 * - Interaction Policy  → até quando o agente pode continuar (lib/interactionBudget.ts);
 * - Message Policy      → janela da Meta, necessidade de template (este ficheiro);
 * - Cost Policy         → impacto estimado (lib/messageBillingLedger.ts + whatsapp_pricing_rules).
 *
 * Regras da Meta são dependência EXTERNA CONFIGURÁVEL (platform setting `meta_policy_versions`
 * + tabela `whatsapp_pricing_rules`). Nunca hardcodar preços, categorias definitivas ou datas.
 *
 * Fontes oficiais:
 * - https://business.whatsapp.com/policy
 * - https://developers.facebook.com/docs/whatsapp/pricing/
 * - https://developers.facebook.com/docs/whatsapp/message-templates/
 */

export type CustomerServiceWindowStatus = "OPEN" | "CLOSED" | "UNKNOWN" | "NOT_APPLICABLE";

export type MessageCategory = "SERVICE" | "UTILITY" | "MARKETING" | "AUTHENTICATION" | "UNKNOWN";

export type MessagePolicyDecision =
  | "ALLOW"
  | "ALLOW_TEMPLATE"
  | "REQUIRES_TEMPLATE"
  | "BLOCKED_WINDOW"
  | "SKIP_PROVIDER_WEBCHAT"
  | "NOT_APPLICABLE";

export type MessagePolicyEvaluation = {
  windowStatus: CustomerServiceWindowStatus;
  windowExpiresAt: Date | null;
  lastCustomerMessageAt: Date | null;
  decision: MessagePolicyDecision;
  reason: string;
  category: MessageCategory;
};

/** Estado da janela de atendimento (24h desde a última mensagem do cliente — regra vigente da Meta). */
export async function getCustomerServiceWindow(conversationId: string): Promise<{
  status: Exclude<CustomerServiceWindowStatus, "NOT_APPLICABLE">;
  lastCustomerMessageAt: Date | null;
  expiresAt: Date | null;
}> {
  const lastInbound = await prisma.message.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!lastInbound) return { status: "CLOSED", lastCustomerMessageAt: null, expiresAt: null };
  const expiresAt = new Date(
    lastInbound.createdAt.getTime() + WHATSAPP_SESSION_WINDOW_HOURS * 60 * 60 * 1000,
  );
  return {
    status: Date.now() <= expiresAt.getTime() ? "OPEN" : "CLOSED",
    lastCustomerMessageAt: lastInbound.createdAt,
    expiresAt,
  };
}

/**
 * Classifica a categoria pela FINALIDADE real da mensagem (nunca só por palavras):
 * - template → categoria aprovada pela Meta no próprio template (metaCategory);
 * - mensagem livre dentro da janela em resposta ao cliente → SERVICE (regra vigente);
 * - caso contrário → UNKNOWN (não assumir cobrança).
 */
export function classifyMessageCategory(input: {
  isTemplate: boolean;
  templateMetaCategory?: string | null;
  windowStatus: CustomerServiceWindowStatus;
}): MessageCategory {
  if (input.isTemplate) {
    const c = (input.templateMetaCategory ?? "").trim().toUpperCase();
    if (c === "UTILITY" || c === "MARKETING" || c === "AUTHENTICATION" || c === "SERVICE") return c;
    return "UNKNOWN";
  }
  if (input.windowStatus === "OPEN" || input.windowStatus === "NOT_APPLICABLE") return "SERVICE";
  return "UNKNOWN";
}

/**
 * Avaliação para envios WhatsApp (Meta Cloud API). Não substitui o enforcement existente
 * em outboundMessage.ts — produz a decisão registada no ledger e o estado da janela.
 */
export async function evaluateWhatsappOutboundPolicy(input: {
  conversationId: string;
  isTemplate: boolean;
  templateMetaCategory?: string | null;
  /** Provider aplica janela? (Meta/360dialog/Twilio sim; Evolution não.) */
  windowEnforced: boolean;
  /** Envio redirecionado ao Web Chat (não sai pelo WhatsApp). */
  webchatDelivery?: boolean;
}): Promise<MessagePolicyEvaluation> {
  if (input.webchatDelivery) {
    return {
      windowStatus: "NOT_APPLICABLE",
      windowExpiresAt: null,
      lastCustomerMessageAt: null,
      decision: "SKIP_PROVIDER_WEBCHAT",
      reason: "Resposta entregue pelo Web Chat — sem consumo WhatsApp",
      category: "SERVICE",
    };
  }

  if (!input.windowEnforced) {
    const w = await getCustomerServiceWindow(input.conversationId);
    return {
      windowStatus: w.status,
      windowExpiresAt: w.expiresAt,
      lastCustomerMessageAt: w.lastCustomerMessageAt,
      decision: input.isTemplate ? "ALLOW_TEMPLATE" : "ALLOW",
      reason: "Provider sem enforcement de janela (Evolution API)",
      category: classifyMessageCategory({
        isTemplate: input.isTemplate,
        templateMetaCategory: input.templateMetaCategory,
        windowStatus: w.status,
      }),
    };
  }

  const w = await getCustomerServiceWindow(input.conversationId);
  const category = classifyMessageCategory({
    isTemplate: input.isTemplate,
    templateMetaCategory: input.templateMetaCategory,
    windowStatus: w.status,
  });

  if (input.isTemplate) {
    return {
      windowStatus: w.status,
      windowExpiresAt: w.expiresAt,
      lastCustomerMessageAt: w.lastCustomerMessageAt,
      decision: "ALLOW_TEMPLATE",
      reason: "Template aprovado — permitido dentro e fora da janela",
      category,
    };
  }

  if (w.status === "OPEN") {
    return {
      windowStatus: w.status,
      windowExpiresAt: w.expiresAt,
      lastCustomerMessageAt: w.lastCustomerMessageAt,
      decision: "ALLOW",
      reason: "Mensagem livre dentro da janela de atendimento (24h)",
      category,
    };
  }

  return {
    windowStatus: w.status,
    windowExpiresAt: w.expiresAt,
    lastCustomerMessageAt: w.lastCustomerMessageAt,
    decision: "REQUIRES_TEMPLATE",
    reason: "Fora da janela de 24h — apenas templates aprovados podem ser enviados",
    category,
  };
}
