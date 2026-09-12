export type ConversationBubbleTheme = {
  conversationBubbleClientColor?: string | null;
  conversationBubbleAgentColor?: string | null;
  conversationBubbleClientColorDark?: string | null;
  conversationBubbleAgentColorDark?: string | null;
  conversationBubbleClientTextColor?: string | null;
  conversationBubbleAgentTextColor?: string | null;
  conversationBubbleClientTextColorDark?: string | null;
  conversationBubbleAgentTextColorDark?: string | null;
  conversationBubbleAgentNameColor?: string | null;
  conversationBubbleAgentNameColorDark?: string | null;
  conversationBubbleClientMetaColor?: string | null;
  conversationBubbleClientMetaColorDark?: string | null;
  conversationBubbleAgentMetaColor?: string | null;
  conversationBubbleAgentMetaColorDark?: string | null;
  conversationAudioPlayerAgentSurfaceColor?: string | null;
  conversationAudioPlayerAgentAccentColor?: string | null;
  conversationAudioPlayerAgentSurfaceColorDark?: string | null;
  conversationAudioPlayerAgentAccentColorDark?: string | null;
  conversationAudioPlayerClientSurfaceColor?: string | null;
  conversationAudioPlayerClientAccentColor?: string | null;
  conversationAudioPlayerClientSurfaceColorDark?: string | null;
  conversationAudioPlayerClientAccentColorDark?: string | null;
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
  agentName: "#6734ff",
  agentNameDark: "#a78bfa",
  clientMeta: "#64748b",
  clientMetaDark: "#94a3b8",
  agentMeta: "#64748b",
  agentMetaDark: "#cbd5e1",
  audioAgentSurface: "#ffffff",
  audioAgentAccent: "#6734ff",
  audioAgentSurfaceDark: "#2f264d",
  audioAgentAccentDark: "#a78bfa",
  audioClientSurface: "#f1f5f9",
  audioClientAccent: "#6734ff",
  audioClientSurfaceDark: "#253041",
  audioClientAccentDark: "#7c5cff",
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
  ["conversationBubbleAgentNameColor", "--org-bubble-agent-name"],
  ["conversationBubbleAgentNameColorDark", "--org-bubble-agent-name-dark"],
  ["conversationBubbleClientMetaColor", "--org-bubble-client-meta"],
  ["conversationBubbleClientMetaColorDark", "--org-bubble-client-meta-dark"],
  ["conversationBubbleAgentMetaColor", "--org-bubble-agent-meta"],
  ["conversationBubbleAgentMetaColorDark", "--org-bubble-agent-meta-dark"],
  ["conversationAudioPlayerAgentSurfaceColor", "--org-audio-player-agent-surface"],
  ["conversationAudioPlayerAgentAccentColor", "--org-audio-player-agent-accent"],
  ["conversationAudioPlayerAgentSurfaceColorDark", "--org-audio-player-agent-surface-dark"],
  ["conversationAudioPlayerAgentAccentColorDark", "--org-audio-player-agent-accent-dark"],
  ["conversationAudioPlayerClientSurfaceColor", "--org-audio-player-client-surface"],
  ["conversationAudioPlayerClientAccentColor", "--org-audio-player-client-accent"],
  ["conversationAudioPlayerClientSurfaceColorDark", "--org-audio-player-client-surface-dark"],
  ["conversationAudioPlayerClientAccentColorDark", "--org-audio-player-client-accent-dark"],
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

/** Variáveis CSS do reprodutor para pré-visualização inline (Aparência). */
export function audioPlayerPreviewStyle(
  mode: "light" | "dark",
  role: "agent" | "client",
  colors: {
    agentSurface: string;
    agentAccent: string;
    clientSurface: string;
    clientAccent: string;
    agentSurfaceDark: string;
    agentAccentDark: string;
    clientSurfaceDark: string;
    clientAccentDark: string;
  },
): Record<string, string> {
  if (role === "agent") {
    if (mode === "dark") {
      return {
        "--org-audio-player-agent-surface-dark": colors.agentSurfaceDark,
        "--org-audio-player-agent-accent-dark": colors.agentAccentDark,
      };
    }
    return {
      "--org-audio-player-agent-surface": colors.agentSurface,
      "--org-audio-player-agent-accent": colors.agentAccent,
    };
  }
  if (mode === "dark") {
    return {
      "--org-audio-player-client-surface-dark": colors.clientSurfaceDark,
      "--org-audio-player-client-accent-dark": colors.clientAccentDark,
    };
  }
  return {
    "--org-audio-player-client-surface": colors.clientSurface,
    "--org-audio-player-client-accent": colors.clientAccent,
  };
}
