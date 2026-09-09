export const CONVERSATION_AGENT_TYPING_EVENT = "openconduit:conversation-agent-typing";

export type ConversationAgentTypingDetail = {
  conversationId: string;
  typing: boolean;
  botId?: string;
  botName?: string;
};

export function publishConversationAgentTyping(detail: ConversationAgentTypingDetail): void {
  window.dispatchEvent(
    new CustomEvent(CONVERSATION_AGENT_TYPING_EVENT, { detail }),
  );
}
