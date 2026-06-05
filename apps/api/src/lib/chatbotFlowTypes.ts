/** Blocos inspirados no modelo Typebot (bubbles, inputs, logic, integrations). */

export const CHATBOT_BLOCK_TYPES = [
  "start",
  "text",
  "image",
  "video",
  "audio",
  "text_input",
  "email_input",
  "number_input",
  "phone_input",
  "date_input",
  "rating_input",
  "choice_input",
  "condition",
  "ab_test",
  "set_variable",
  "script",
  "redirect",
  "openai",
  "webhook",
  "add_tag",
  "handoff",
  "wait",
  "jump",
  "end",
] as const;

export type ChatbotBlockType = (typeof CHATBOT_BLOCK_TYPES)[number];

export interface ChatbotFlowNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface ChatbotFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Ramo opcional: yes | no | a | b | … (ab_test) */
  branch?: string;
}

export interface ChatbotFlowVariableDef {
  id: string;
  name: string;
  value?: string;
  isSessionVariable?: boolean;
}

export interface ChatbotFlowDefinition {
  nodes: ChatbotFlowNode[];
  edges: ChatbotFlowEdge[];
}

export interface ChatbotWaitingInput {
  nodeId: string;
  kind: "text" | "choice" | "wait" | "email" | "number" | "phone" | "date" | "rating";
  variableName: string;
  prompt?: string;
  choices?: { id: string; label: string }[];
  /** ISO — bloco wait: retomar fluxo após esta data */
  resumeAt?: string;
  numberMin?: number;
  numberMax?: number;
  ratingMin?: number;
  ratingMax?: number;
}

export function parseChatbotFlowDefinition(raw: unknown): ChatbotFlowDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return null;
  return { nodes: o.nodes as ChatbotFlowNode[], edges: o.edges as ChatbotFlowEdge[] };
}

export function parseChatbotVariableDefs(raw: unknown): ChatbotFlowVariableDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((x) => ({
      id: typeof x.id === "string" ? x.id : `var_${String(x.name ?? "x")}`,
      name: typeof x.name === "string" ? x.name : "var",
      value: typeof x.value === "string" ? x.value : undefined,
      isSessionVariable: x.isSessionVariable === true,
    }));
}

export function defaultChatbotFlowDefinition(): ChatbotFlowDefinition {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 80, y: 200 }, data: {} },
      {
        id: "welcome",
        type: "text",
        position: { x: 400, y: 180 },
        data: { content: "Olá {{contact.name}}! Como posso ajudar?" },
      },
      {
        id: "ask",
        type: "text_input",
        position: { x: 720, y: 160 },
        data: { variableName: "resposta", prompt: "Digite sua mensagem:" },
      },
      { id: "end", type: "end", position: { x: 1040, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "welcome" },
      { id: "e2", source: "welcome", target: "ask" },
      { id: "e3", source: "ask", target: "end" },
    ],
  };
}

/** Resolve URL de blocos image/video/audio (link directo, variável ou template {{var}}). */
export function resolveChatbotMediaUrl(
  data: Record<string, unknown> | undefined,
  vars: Record<string, string>,
  contact: { name: string; phone?: string; email?: string | null },
): string {
  if (!data) return "";
  const mode = String(data.urlSource ?? "link").trim();
  if (mode === "variable") {
    const varName = String(data.urlVariable ?? "media_url").trim();
    const fromVar = vars[varName]?.trim();
    if (fromVar) return fromVar;
    const fallback = String(data.url ?? data.mediaUrl ?? "").trim();
    if (fallback) return substituteChatbotVariables(fallback, vars, contact).trim();
    return "";
  }
  return substituteChatbotVariables(String(data.url ?? data.mediaUrl ?? "").trim(), vars, contact).trim();
}

export function substituteChatbotVariables(
  text: string,
  vars: Record<string, string>,
  contact: { name: string; phone?: string; email?: string | null },
): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi"), v);
  }
  out = out
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, contact.name)
    .replace(/\{\{\s*contact\.phone\s*\}\}/gi, contact.phone ?? "")
    .replace(/\{\{\s*contact\.email\s*\}\}/gi, contact.email ?? "")
    .replace(/\{\{\s*nome\s*\}\}/gi, contact.name);
  return out;
}

export function botVisualChatbotFlowId(config: unknown): string | null {
  if (config == null || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (c.flowEngine !== "visual") return null;
  const id = c.chatbotFlowId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function botConfigForVisualFlow(chatbotFlowId: string): Record<string, unknown> {
  return {
    flowEngine: "visual",
    chatbotFlowId,
    automationManagedByOpenConduit: false,
  };
}
