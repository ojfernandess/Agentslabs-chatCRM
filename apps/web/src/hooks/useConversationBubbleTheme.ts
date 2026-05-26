import { useEffect } from "react";
import { api } from "@/lib/api";
import {
  applyConversationBubbleTheme,
  clearConversationBubbleTheme,
  type ConversationBubbleTheme,
} from "@/lib/conversationBubbleTheme";

export function useConversationBubbleTheme(enabled: boolean, organizationKey?: string | null) {
  useEffect(() => {
    if (!enabled) {
      clearConversationBubbleTheme();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const theme = await api.get<ConversationBubbleTheme>("/settings/conversation-appearance");
        if (!cancelled) applyConversationBubbleTheme(theme);
      } catch {
        if (!cancelled) clearConversationBubbleTheme();
      }
    };

    void load();

    return () => {
      cancelled = true;
      clearConversationBubbleTheme();
    };
  }, [enabled, organizationKey]);
}
