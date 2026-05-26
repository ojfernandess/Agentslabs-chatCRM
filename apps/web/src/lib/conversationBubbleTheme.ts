export type ConversationBubbleTheme = {
  conversationBubbleClientColor?: string | null;
  conversationBubbleAgentColor?: string | null;
  conversationBubbleClientColorDark?: string | null;
  conversationBubbleAgentColorDark?: string | null;
  conversationBubbleClientTextColor?: string | null;
  conversationBubbleAgentTextColor?: string | null;
  conversationBubbleClientTextColorDark?: string | null;
  conversationBubbleAgentTextColorDark?: string | null;
};

export const DEFAULT_BUBBLE_THEME = {
  client: "#ffffff",
  agent: "#ebe8ff",
  clientDark: "#1e293b",
  agentDark: "#3b2d6e",
  clientText: "#0f172a",
  agentText: "#0f172a",
  clientTextDark: "#f8fafc",
  agentTextDark: "#f8fafc",
} as const;

const THEME_VAR_PAIRS: [keyof ConversationBubbleTheme, string][] = [
  ["conversationBubbleClientColor", "--org-bubble-client-bg"],
  ["conversationBubbleAgentColor", "--org-bubble-agent-bg"],
  ["conversationBubbleClientColorDark", "--org-bubble-client-bg-dark"],
  ["conversationBubbleAgentColorDark", "--org-bubble-agent-bg-dark"],
  ["conversationBubbleClientTextColor", "--org-bubble-client-text"],
  ["conversationBubbleAgentTextColor", "--org-bubble-agent-text"],
  ["conversationBubbleClientTextColorDark", "--org-bubble-client-text-dark"],
  ["conversationBubbleAgentTextColorDark", "--org-bubble-agent-text-dark"],
];

export function hasCustomBubbleTheme(theme: ConversationBubbleTheme | null | undefined): boolean {
  if (!theme) return false;
  return THEME_VAR_PAIRS.some(([key]) => {
    const value = theme[key];
    return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
  });
}

export function applyConversationBubbleTheme(theme: ConversationBubbleTheme | null | undefined): void {
  const root = document.documentElement;

  for (const [key, cssVar] of THEME_VAR_PAIRS) {
    const value = theme?.[key];
    if (value && /^#[0-9A-Fa-f]{6}$/.test(value)) {
      root.style.setProperty(cssVar, value);
    } else {
      root.style.removeProperty(cssVar);
    }
  }
}

export function clearConversationBubbleTheme(): void {
  applyConversationBubbleTheme(null);
}
