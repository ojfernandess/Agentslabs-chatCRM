export const CONVERSATION_AGENT_TYPING_EVENT = "openconduit:conversation-agent-typing";

export type ConversationAgentTypingDetail = {
  conversationId: string;
  typing: boolean;
  botId?: string;
  botName?: string;
};

export type AgentTypingEntry = { botName: string };

export type AgentTypingModel = {
  byConversation: Map<string, AgentTypingEntry>;
  /** Conversas em handoff humano: ignora um "digitando" tardio depois da transferência. */
  handoffMuted: Set<string>;
};

export type AgentTypingSignal =
  | { kind: "typing"; conversationId: string; typing: boolean; botName?: string }
  | { kind: "outbound"; conversationId: string }
  | { kind: "handoff"; conversationId: string; awaitingHumanHandoff: boolean };

export function createAgentTypingModel(): AgentTypingModel {
  return { byConversation: new Map(), handoffMuted: new Set() };
}

function cloneAgentTypingModel(model: AgentTypingModel): AgentTypingModel {
  return {
    byConversation: new Map(model.byConversation),
    handoffMuted: new Set(model.handoffMuted),
  };
}

/** Atualiza o indicador. Devolve o mesmo objeto quando nada muda. */
export function applyAgentTypingSignal(model: AgentTypingModel, signal: AgentTypingSignal): AgentTypingModel {
  if (signal.kind === "handoff") {
    if (signal.awaitingHumanHandoff) {
      if (
        model.handoffMuted.has(signal.conversationId) &&
        !model.byConversation.has(signal.conversationId)
      ) {
        return model;
      }
      const next = cloneAgentTypingModel(model);
      next.handoffMuted.add(signal.conversationId);
      next.byConversation.delete(signal.conversationId);
      return next;
    }
    if (!model.handoffMuted.has(signal.conversationId)) return model;
    const next = cloneAgentTypingModel(model);
    next.handoffMuted.delete(signal.conversationId);
    return next;
  }

  if (signal.kind === "outbound") {
    if (!model.byConversation.has(signal.conversationId)) return model;
    const next = cloneAgentTypingModel(model);
    next.byConversation.delete(signal.conversationId);
    return next;
  }

  if (signal.typing) {
    if (model.handoffMuted.has(signal.conversationId)) return model;
    const botName = signal.botName?.trim() ?? "";
    const current = model.byConversation.get(signal.conversationId);
    if (current && current.botName === botName) return model;
    const next = cloneAgentTypingModel(model);
    next.byConversation.set(signal.conversationId, { botName });
    return next;
  }

  if (!model.byConversation.has(signal.conversationId)) return model;
  const next = cloneAgentTypingModel(model);
  next.byConversation.delete(signal.conversationId);
  return next;
}

export function publishConversationAgentTyping(detail: ConversationAgentTypingDetail): void {
  window.dispatchEvent(
    new CustomEvent(CONVERSATION_AGENT_TYPING_EVENT, { detail }),
  );
}
