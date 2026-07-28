/** Turno proactivo do agente — regra declarativa em behaviorConfig.agentContinuation. */

export type AgentContinuationTrigger = "after_reply" | "after_tool_round";

export type AgentContinuationWhen = {
  /** Nome exacto ou substring de ferramenta invocada no turno. */
  toolCalled?: string;
  /** Exige sucesso da ferramenta correspondente (quando toolCalled definido). */
  toolOk?: boolean;
  /** Etapa de fluxo persistida (flowStep). */
  flowStep?: string;
  /** Última ronda entregou resposta substantiva ao cliente. */
  resultDelivered?: boolean;
  /** Resposta final contém este texto (case-insensitive). */
  replyContains?: string;
  /** Mínimo de caracteres na resposta final. */
  replyMinChars?: number;
};

export type AgentContinuationRule = {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: AgentContinuationTrigger;
  when?: AgentContinuationWhen;
  /** Atraso antes de executar o turno seguinte (segundos). Default 3. */
  delaySeconds?: number;
  /** Máximo de disparos desta regra por conversa. Default 1. */
  maxPerConversation?: number;
  /** Instrução injectada como mensagem sintética do turno proactivo. */
  turnHint: string;
};

export type AgentContinuationConfig = {
  enabled?: boolean;
  rules?: AgentContinuationRule[];
};

export type PendingAgentContinuation = {
  ruleId: string;
  ruleName?: string;
  scheduledAt: string;
  turnHint: string;
  sourceExecutionId?: string;
  attempts: number;
};

export type ContinuationTurnContext = {
  userMessage: string;
  replyText: string;
  toolRound?: {
    tools: Array<{ name: string; ok: boolean; preview: string }>;
    resultDeliveredToCustomer: boolean;
  };
  flowStep?: string;
  flowSlots?: Record<string, string | number | boolean>;
};
