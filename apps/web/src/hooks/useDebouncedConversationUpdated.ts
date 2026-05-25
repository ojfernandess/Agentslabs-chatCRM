import { useEffect, useRef, useCallback } from "react";

const DEBOUNCE_MS = 350;

export type ConversationUpdatedDetail = {
  conversationId?: string;
  awaitingHumanHandoff?: boolean;
};

/**
 * Escuta `openconduit:conversation-updated` (WebSocket → WorkspaceRealtime) e
 * chama `onUpdate` com debounce para evitar rajadas de GET ao receber várias mensagens.
 */
export function useDebouncedConversationUpdated(
  onUpdate: (detail: ConversationUpdatedDetail | undefined) => void,
  options?: { conversationId?: string },
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationId = options?.conversationId;

  const schedule = useCallback((detail: ConversationUpdatedDetail | undefined) => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onUpdateRef.current(detail);
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<ConversationUpdatedDetail>).detail;
      if (conversationId && d?.conversationId && d.conversationId !== conversationId) return;
      schedule(d);
    };
    window.addEventListener("openconduit:conversation-updated", h);
    return () => {
      window.removeEventListener("openconduit:conversation-updated", h);
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, [conversationId, schedule]);
}
