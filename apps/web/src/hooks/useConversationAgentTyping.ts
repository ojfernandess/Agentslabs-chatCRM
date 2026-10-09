import { useSyncExternalStore } from "react";
import {
  applyAgentTypingSignal,
  CONVERSATION_AGENT_TYPING_EVENT,
  createAgentTypingModel,
  type AgentTypingModel,
  type ConversationAgentTypingDetail,
} from "@/lib/conversationAgentTyping";
import {
  CONVERSATION_MESSAGE_CREATED_EVENT,
  type ConversationMessageCreatedDetail,
} from "@/lib/conversationMessagePush";

export type ConversationAgentTypingState = {
  botName: string;
};

const CONVERSATION_UPDATED_EVENT = "openconduit:conversation-updated";

let typingModel: AgentTypingModel = createAgentTypingModel();
const storeListeners = new Set<() => void>();
let globalListenersBound = false;

function notifyTypingStore(): void {
  for (const listener of storeListeners) {
    listener();
  }
}

function commitTypingModel(next: AgentTypingModel): void {
  if (next === typingModel) return;
  typingModel = next;
  notifyTypingStore();
}

function bindGlobalTypingListeners(): void {
  if (globalListenersBound) return;
  globalListenersBound = true;

  const onTyping = (e: Event) => {
    const detail = (e as CustomEvent<ConversationAgentTypingDetail>).detail;
    if (!detail?.conversationId || typeof detail.typing !== "boolean") return;
    commitTypingModel(
      applyAgentTypingSignal(typingModel, {
        kind: "typing",
        conversationId: detail.conversationId,
        typing: detail.typing,
        botName: detail.botName,
      }),
    );
  };

  const onMessageCreated = (e: Event) => {
    const detail = (e as CustomEvent<ConversationMessageCreatedDetail>).detail;
    if (!detail?.conversationId) return;
    if (detail.message?.direction !== "OUTBOUND") return;
    commitTypingModel(
      applyAgentTypingSignal(typingModel, {
        kind: "outbound",
        conversationId: detail.conversationId,
      }),
    );
  };

  const onConversationUpdated = (e: Event) => {
    const detail = (e as CustomEvent<{ conversationId?: string; awaitingHumanHandoff?: boolean }>).detail;
    if (!detail?.conversationId || typeof detail.awaitingHumanHandoff !== "boolean") return;
    commitTypingModel(
      applyAgentTypingSignal(typingModel, {
        kind: "handoff",
        conversationId: detail.conversationId,
        awaitingHumanHandoff: detail.awaitingHumanHandoff,
      }),
    );
  };

  window.addEventListener(CONVERSATION_AGENT_TYPING_EVENT, onTyping);
  window.addEventListener(CONVERSATION_MESSAGE_CREATED_EVENT, onMessageCreated);
  window.addEventListener(CONVERSATION_UPDATED_EVENT, onConversationUpdated);
}

function subscribeTypingStore(listener: () => void): () => void {
  bindGlobalTypingListeners();
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function getTypingStoreSnapshot(): Map<string, ConversationAgentTypingState> {
  return typingModel.byConversation;
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
