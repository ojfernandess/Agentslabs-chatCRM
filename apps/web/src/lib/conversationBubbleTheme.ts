export type ConversationBubbleTheme = {
  conversationBubbleClientColor?: string | null;
  conversationBubbleAgentColor?: string | null;
  conversationBubbleClientColorDark?: string | null;
  conversationBubbleAgentColorDark?: string | null;
};

export const DEFAULT_BUBBLE_THEME = {
  client: "#ffffff",
  agent: "#ebe8ff",
  clientDark: "#1e293b",
  agentDark: "#3b2d6e",
} as const;

export function applyConversationBubbleTheme(theme: ConversationBubbleTheme | null | undefined): void {
  const root = document.documentElement;
  const pairs: [string, string | null | undefined][] = [
    ["--org-bubble-client-bg", theme?.conversationBubbleClientColor],
    ["--org-bubble-agent-bg", theme?.conversationBubbleAgentColor],
    ["--org-bubble-client-bg-dark", theme?.conversationBubbleClientColorDark],
    ["--org-bubble-agent-bg-dark", theme?.conversationBubbleAgentColorDark],
  ];

  for (const [name, value] of pairs) {
    if (value && /^#[0-9A-Fa-f]{6}$/.test(value)) {
      root.style.setProperty(name, value);
    } else {
      root.style.removeProperty(name);
    }
  }
}

export function clearConversationBubbleTheme(): void {
  applyConversationBubbleTheme(null);
}
