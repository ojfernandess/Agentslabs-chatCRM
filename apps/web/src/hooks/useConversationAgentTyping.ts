import { useEffect, useState } from "react";
import {
  CONVERSATION_AGENT_TYPING_EVENT,
  type ConversationAgentTypingDetail,
} from "@/lib/conversationAgentTyping";

export type ConversationAgentTypingState = {
  botName: string;
};

/**
 * Estado de digitação do bot para uma conversa (WebSocket → evento DOM).
 * Sem `conversationId`, escuta todas as conversas (lista / split-view).
 */
export function useConversationAgentTyping(conversationId?: string) {
  const [typing, setTyping] = useState<ConversationAgentTypingState | null>(null);

  useEffect(() => {
    const onTyping = (e: Event) => {
      const detail = (e as CustomEvent<ConversationAgentTypingDetail>).detail;
      if (!detail?.conversationId) return;
      if (conversationId && detail.conversationId !== conversationId) return;

      if (detail.typing) {
        setTyping({ botName: detail.botName?.trim() ?? "" });
      } else {
        setTyping(null);
      }
    };

    window.addEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
    return () => window.removeEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
  }, [conversationId]);

  return typing;
}

/** Mapa conversationId → bot a digitar (lista / split-view). */
export function useConversationAgentTypingMap() {
  const [byConversation, setByConversation] = useState<
    Map<string, ConversationAgentTypingState>
  >(() => new Map());

  useEffect(() => {
    const onTyping = (e: Event) => {
      const detail = (e as CustomEvent<ConversationAgentTypingDetail>).detail;
      if (!detail?.conversationId) return;

      setByConversation((prev) => {
        const next = new Map(prev);
        if (detail.typing) {
          next.set(detail.conversationId, { botName: detail.botName?.trim() ?? "" });
        } else {
          next.delete(detail.conversationId);
        }
        return next;
      });
    };

    window.addEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
    return () => window.removeEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
  }, []);

  return byConversation;
}
