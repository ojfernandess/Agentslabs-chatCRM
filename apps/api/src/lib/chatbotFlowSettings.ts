/** Tema e eventos do fluxo (Fase 4 — JSON em `ChatbotFlow.theme` / `settings`). */

export interface ChatbotFlowTheme {
  primaryColor?: string;
  backgroundColor?: string;
  botBubbleColor?: string;
  guestBubbleColor?: string;
  fontFamily?: string;
  borderRadius?: number;
  logoUrl?: string;
  headerTitle?: string;
}

export interface ChatbotFlowCommand {
  trigger: string;
  targetNodeId: string;
}

export interface ChatbotFlowEventsSettings {
  invalidReplyMessage?: string;
  commands?: ChatbotFlowCommand[];
}

export interface ChatbotFlowSettings {
  events?: ChatbotFlowEventsSettings;
}

export const DEFAULT_CHATBOT_THEME: ChatbotFlowTheme = {
  primaryColor: "#ff6b2c",
  backgroundColor: "#f4f5f7",
  botBubbleColor: "#ffffff",
  guestBubbleColor: "#fff4ed",
  fontFamily: "system-ui, sans-serif",
  borderRadius: 16,
};

export function parseChatbotFlowTheme(raw: unknown): ChatbotFlowTheme {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CHATBOT_THEME };
  const o = raw as Record<string, unknown>;
  return {
    primaryColor:
      typeof o.primaryColor === "string" ? o.primaryColor : DEFAULT_CHATBOT_THEME.primaryColor,
    backgroundColor:
      typeof o.backgroundColor === "string" ? o.backgroundColor : DEFAULT_CHATBOT_THEME.backgroundColor,
    botBubbleColor:
      typeof o.botBubbleColor === "string" ? o.botBubbleColor : DEFAULT_CHATBOT_THEME.botBubbleColor,
    guestBubbleColor:
      typeof o.guestBubbleColor === "string" ? o.guestBubbleColor : DEFAULT_CHATBOT_THEME.guestBubbleColor,
    fontFamily: typeof o.fontFamily === "string" ? o.fontFamily : DEFAULT_CHATBOT_THEME.fontFamily,
    borderRadius:
      typeof o.borderRadius === "number" && Number.isFinite(o.borderRadius)
        ? o.borderRadius
        : DEFAULT_CHATBOT_THEME.borderRadius,
    logoUrl: typeof o.logoUrl === "string" ? o.logoUrl : undefined,
    headerTitle: typeof o.headerTitle === "string" ? o.headerTitle : undefined,
  };
}

export function parseChatbotFlowSettings(raw: unknown): ChatbotFlowSettings {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const eventsRaw = o.events;
  if (!eventsRaw || typeof eventsRaw !== "object") return {};
  const ev = eventsRaw as Record<string, unknown>;
  const commands: ChatbotFlowCommand[] = Array.isArray(ev.commands)
    ? ev.commands
        .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
        .map((c) => ({
          trigger: typeof c.trigger === "string" ? c.trigger.trim() : "",
          targetNodeId: typeof c.targetNodeId === "string" ? c.targetNodeId.trim() : "",
        }))
        .filter((c) => c.trigger && c.targetNodeId)
    : [];
  return {
    events: {
      invalidReplyMessage:
        typeof ev.invalidReplyMessage === "string" ? ev.invalidReplyMessage : undefined,
      commands: commands.length ? commands : undefined,
    },
  };
}

export function matchChatbotCommand(
  userText: string,
  commands: ChatbotFlowCommand[] | undefined,
  nodeIds: Set<string>,
): string | null {
  if (!commands?.length || !userText.trim()) return null;
  const t = userText.trim().toLowerCase();
  for (const c of commands) {
    if (c.trigger.toLowerCase() === t && nodeIds.has(c.targetNodeId)) return c.targetNodeId;
  }
  return null;
}

export function formatInvalidReplyMessage(
  template: string | undefined,
  validationMessage: string,
  waitingPrompt: string | undefined,
  substitute: (text: string) => string,
): string {
  if (template?.trim()) {
    return substitute(template)
      .replace(/\{\{\s*error\s*\}\}/gi, validationMessage)
      .replace(/\{\{\s*message\s*\}\}/gi, validationMessage)
      .trim();
  }
  return `${waitingPrompt ? `${waitingPrompt}\n\n` : ""}⚠ ${validationMessage}`.trim();
}
