import type { InteractionBudgetStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";

/**
 * Interaction Budget — orçamento de interações do agente por CONVERSA (não por canal).
 *
 * Regras (spec Message Policy Engine + Interaction Limit):
 * - 1 resposta automática efetivamente enviada pelo agente = 1 interação;
 * - mensagens do cliente, tool calls, mensagens humanas e envios falhados NÃO contam;
 * - troca de canal (WhatsApp → Web Chat) NÃO reinicia o contador;
 * - ao atingir o limite: call_human automático e agente pausado (awaitingHumanHandoff);
 * - reset apenas quando o humano devolve explicitamente a conversa para a IA.
 */

export const INTERACTION_NEAR_LIMIT_THRESHOLD = 3;

export type InteractionLimitConfig = {
  enabled: boolean;
  /** null quando desativado — comportamento atual permanece igual. */
  limit: number | null;
  /** Ao aproximar-se do limite, o agente deve enviar o link do Web Chat (não gera 11ª mensagem). */
  offerWebchatOnLimit: boolean;
  /** Caixas WhatsApp Meta Cloud API selecionadas; vazio = todas (legado). */
  inboxIds: string[];
};

/** Lê `behaviorConfig.interactionLimit` do perfil do agente (Editar Agente → Controle de atendimento). */
export function parseInteractionLimitFromBehavior(behavior: unknown): InteractionLimitConfig {
  const off: InteractionLimitConfig = { enabled: false, limit: null, offerWebchatOnLimit: false, inboxIds: [] };
  if (!behavior || typeof behavior !== "object") return off;
  const raw = (behavior as Record<string, unknown>).interactionLimit;
  if (!raw || typeof raw !== "object") return off;
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  const limitRaw = o.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : null;
  const inboxIds = Array.isArray(o.inboxIds)
    ? o.inboxIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (!enabled || limit == null) return off;
  return { enabled: true, limit, offerWebchatOnLimit: o.offerWebchatOnLimit === true, inboxIds };
}

/** Limite activo nesta conversa — vazio em inboxIds mantém comportamento legado (todas as caixas). */
export function interactionLimitAppliesToInbox(
  config: InteractionLimitConfig,
  inboxId: string | null | undefined,
): boolean {
  if (!config.enabled) return false;
  if (config.inboxIds.length === 0) return true;
  if (!inboxId?.trim()) return false;
  return config.inboxIds.includes(inboxId);
}

export type InteractionBudgetState = {
  enabled: boolean;
  count: number;
  limit: number | null;
  remaining: number | null;
  status: InteractionBudgetStatus;
  /** true quando count >= limit — nenhuma nova resposta automática pode ser produzida. */
  blocked: boolean;
  nearLimit: boolean;
};

const DISABLED_STATE: InteractionBudgetState = {
  enabled: false,
  count: 0,
  limit: null,
  remaining: null,
  status: "DISABLED",
  blocked: false,
  nearLimit: false,
};

/** Próxima resposta enviada consome a última interação permitida (antes da transferência). */
export function isLastAllowedAgentReply(budgetState: InteractionBudgetState | null): boolean {
  if (!budgetState?.enabled || budgetState.limit == null) return false;
  if (budgetState.blocked) return false;
  return budgetState.count + 1 >= budgetState.limit;
}

/** Envia link do Web Chat apenas na última resposta automática, quando a opção está activa. */
export function shouldAppendWebchatLinkOnReply(
  behaviorConfig: unknown,
  budgetState: InteractionBudgetState | null,
): boolean {
  const cfg = parseInteractionLimitFromBehavior(behaviorConfig);
  if (!cfg.offerWebchatOnLimit) return false;
  return isLastAllowedAgentReply(budgetState);
}

/** Deriva estado puro a partir de count/limit (testável sem BD). */
export function deriveBudgetStatus(count: number, limit: number): InteractionBudgetStatus {
  if (count >= limit) return "LIMIT_REACHED";
  if (limit - count <= INTERACTION_NEAR_LIMIT_THRESHOLD) return "NEAR_LIMIT";
  return "ACTIVE";
}

async function interactionLimitFeatureEnabled(organizationId: string): Promise<boolean> {
  try {
    return await isOrganizationFeatureEnabled(organizationId, "agent_interaction_limit");
  } catch {
    return true;
  }
}

/** Estado atual do orçamento — usado como gate antes da geração e para contexto de runtime. */
export async function getInteractionBudgetState(params: {
  organizationId: string;
  conversationId: string;
  behaviorConfig: unknown;
  inboxId?: string | null;
}): Promise<InteractionBudgetState> {
  const cfg = parseInteractionLimitFromBehavior(params.behaviorConfig);
  if (!cfg.enabled || cfg.limit == null) return DISABLED_STATE;
  if (!interactionLimitAppliesToInbox(cfg, params.inboxId)) return DISABLED_STATE;
  if (!(await interactionLimitFeatureEnabled(params.organizationId))) return DISABLED_STATE;

  const row = await prisma.conversationInteractionBudget.findUnique({
    where: { conversationId: params.conversationId },
    select: { interactionCount: true, status: true },
  });
  const count = row?.interactionCount ?? 0;
  const status = row?.status === "HUMAN_ACTIVE" ? "HUMAN_ACTIVE" : deriveBudgetStatus(count, cfg.limit);
  return {
    enabled: true,
    count,
    limit: cfg.limit,
    remaining: Math.max(0, cfg.limit - count),
    status,
    blocked: count >= cfg.limit,
    nearLimit: cfg.limit - count <= INTERACTION_NEAR_LIMIT_THRESHOLD && count < cfg.limit,
  };
}

export type RegisterInteractionResult = {
  count: number;
  limit: number;
  remaining: number;
  limitReached: boolean;
  nearLimit: boolean;
  status: InteractionBudgetStatus;
};

/**
 * Regista 1 interação (resposta do agente efetivamente enviada).
 * Incremento atómico; atualiza status ACTIVE → NEAR_LIMIT → LIMIT_REACHED.
 */
export async function registerAgentInteraction(params: {
  organizationId: string;
  conversationId: string;
  agentBotId: string;
  limit: number;
}): Promise<RegisterInteractionResult> {
  const now = new Date();
  const updated = await prisma.conversationInteractionBudget.upsert({
    where: { conversationId: params.conversationId },
    create: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      agentBotId: params.agentBotId,
      interactionCount: 1,
      interactionLimit: params.limit,
      lastInteractionAt: now,
      status: deriveBudgetStatus(1, params.limit),
      ...(1 >= params.limit ? { limitReachedAt: now } : {}),
    },
    update: {
      interactionCount: { increment: 1 },
      interactionLimit: params.limit,
      agentBotId: params.agentBotId,
      lastInteractionAt: now,
    },
  });

  const count = updated.interactionCount;
  const status = deriveBudgetStatus(count, params.limit);
  if (updated.status !== status || (status === "LIMIT_REACHED" && !updated.limitReachedAt)) {
    await prisma.conversationInteractionBudget.update({
      where: { conversationId: params.conversationId },
      data: {
        status,
        ...(status === "LIMIT_REACHED" && !updated.limitReachedAt ? { limitReachedAt: now } : {}),
      },
    });
  }

  return {
    count,
    limit: params.limit,
    remaining: Math.max(0, params.limit - count),
    limitReached: count >= params.limit,
    nearLimit: params.limit - count <= INTERACTION_NEAR_LIMIT_THRESHOLD && count < params.limit,
    status,
  };
}

/** Marca HUMAN_ACTIVE após o call_human automático. */
export async function markInteractionBudgetHumanActive(conversationId: string): Promise<void> {
  await prisma.conversationInteractionBudget
    .updateMany({
      where: { conversationId },
      data: { status: "HUMAN_ACTIVE", updatedAt: new Date() },
    })
    .catch(() => {});
}

/**
 * Reset explícito HUMAN → AI (devolver à fila do bot): contador volta a 0, novo ciclo.
 * NÃO chamar por nova mensagem do cliente, passagem de tempo ou troca de canal.
 */
export async function resetInteractionBudgetForConversation(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await prisma.conversationInteractionBudget
    .updateMany({
      where: { conversationId, organizationId },
      data: {
        interactionCount: 0,
        status: "ACTIVE",
        limitReachedAt: null,
        updatedAt: new Date(),
      },
    })
    .catch(() => {});
}

/**
 * Appendix de contexto de runtime (Cost-Aware Messaging / Modo Economia).
 * Fornece os dados como metadata ao agente sem modificar o comportamento de forma invasiva.
 */
export function buildInteractionBudgetPromptAppendix(
  state: InteractionBudgetState,
  options?: { offerWebchatOnLimit?: boolean; webchatUrl?: string | null },
): string {
  if (!state.enabled || state.limit == null || state.remaining == null) return "";
  if (!state.nearLimit && !state.blocked) return "";
  const meta = JSON.stringify({
    interaction_count: state.count,
    interaction_limit: state.limit,
    remaining_interactions: state.remaining,
  });
  const lines: string[] = [
    "",
    "",
    "[OpenNexo — Controle de atendimento / Modo economia]",
    `Contexto de runtime: ${meta}`,
    "Esta conversa está próxima do limite de respostas automáticas. Orientações:",
    "- consolide as informações e evite respostas fragmentadas ou múltiplas mensagens consecutivas;",
    "- evite perguntas desnecessárias; resolva a solicitação na menor quantidade razoável de mensagens;",
  ];
  if (options?.offerWebchatOnLimit && state.remaining === 1) {
    lines.push(
      "- envie o link do Web Chat nesta resposta para o cliente continuar a mesma conversa pelo atendimento online;",
    );
    if (options.webchatUrl) {
      lines.push(
        `- URL já gerada pelo sistema (nunca invente outra; use exatamente esta): ${options.webchatUrl}`,
      );
    } else {
      lines.push(
        "- use a ferramenta generate_webchat_link e inclua exatamente a URL retornada (nunca invente a URL).",
      );
    }
  }
  if (state.remaining === 1) {
    lines.push(
      "- ATENÇÃO: esta é a ÚLTIMA resposta automática permitida. Encerre informando que vai encaminhar o atendimento para a equipe humana (ex.: \"Vou encaminhar você para nossa equipe para continuar o atendimento.\"). NÃO prometa responder novamente.",
    );
  }
  return lines.join("\n");
}

/** Conveniência: estado + appendix em uma chamada (usado na montagem do system prompt). */
export async function buildInteractionBudgetPromptAppendixForConversation(params: {
  organizationId: string;
  conversationId: string;
  behaviorConfig: unknown;
  inboxId?: string | null;
}): Promise<string> {
  const cfg = parseInteractionLimitFromBehavior(params.behaviorConfig);
  if (!cfg.enabled || !interactionLimitAppliesToInbox(cfg, params.inboxId)) return "";
  try {
    const state = await getInteractionBudgetState(params);
    let webchatUrl: string | null = null;
    const offerWebchatOnLastReply = cfg.offerWebchatOnLimit && state.remaining === 1;
    if (offerWebchatOnLastReply) {
      try {
        const { generateWebchatLinkForConversation } = await import("./webchatSession.js");
        const r = await generateWebchatLinkForConversation({
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          createdBySource: "AGENT",
        });
        if (r.ok) webchatUrl = r.url;
      } catch {
        webchatUrl = null;
      }
    }
    return buildInteractionBudgetPromptAppendix(state, {
      offerWebchatOnLimit: offerWebchatOnLastReply,
      webchatUrl,
    });
  } catch {
    return "";
  }
}
