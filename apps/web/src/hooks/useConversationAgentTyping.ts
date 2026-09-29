import { useSyncExternalStore } from "react";
import {
  CONVERSATION_AGENT_TYPING_EVENT,
  type ConversationAgentTypingDetail,
} from "@/lib/conversationAgentTyping";
import {
  CONVERSATION_MESSAGE_CREATED_EVENT,
  type ConversationMessageCreatedDetail,
} from "@/lib/conversationMessagePush";

export type ConversationAgentTypingState = {
  botName: string;
};

let typingByConversation = new Map<string, ConversationAgentTypingState>();
const storeListeners = new Set<() => void>();
let globalListenersBound = false;

function notifyTypingStore(): void {
  for (const listener of storeListeners) {
    listener();
  }
}

function replaceTypingStore(next: Map<string, ConversationAgentTypingState>): void {
  typingByConversation = next;
  notifyTypingStore();
}

function clearConversationTyping(conversationId: string): void {
  if (!typingByConversation.has(conversationId)) return;
  const next = new Map(typingByConversation);
  next.delete(conversationId);
  replaceTypingStore(next);
}

function bindGlobalTypingListeners(): void {
  if (globalListenersBound) return;
  globalListenersBound = true;

  const onTyping = (e: Event) => {
    const detail = (e as CustomEvent<ConversationAgentTypingDetail>).detail;
    if (!detail?.conversationId) return;

    const next = new Map(typingByConversation);
    if (detail.typing) {
      next.set(detail.conversationId, { botName: detail.botName?.trim() ?? "" });
    } else {
      next.delete(detail.conversationId);
    }
    replaceTypingStore(next);
  };

  const onMessageCreated = (e: Event) => {
    const detail = (e as CustomEvent<ConversationMessageCreatedDetail>).detail;
    if (!detail?.conversationId) return;
    if (detail.message?.direction !== "OUTBOUND") return;
    clearConversationTyping(detail.conversationId);
  };

  window.addEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
  window.addEventListener(CONVERSATION_MESSAGE_CREATED_EVENT, onMessageCreated);
}

function subscribeTypingStore(listener: () => void): () => void {
  bindGlobalTypingListeners();
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function getTypingStoreSnapshot(): Map<string, ConversationAgentTypingState> {
  return typingByConversation;
}

/**
 * Estado de digitação do bot para uma conversa (WebSocket → evento DOM).
 * Partilha o mesmo store que a lista / split-view.
 */
export function useConversationAgentTyping(conversationId?: string) {
  const byConversation = useConversationAgentTypingMap();
  if (!conversationId) return null;
  return byConversation.get(conversationId) ?? null;
}

/** Mapa conversationId → bot a digitar (lista / split-view). */
export function useConversationAgentTypingMap() {
  return useSyncExternalStore(subscribeTypingStore, getTypingStoreSnapshot, getTypingStoreSnapshot);
}
