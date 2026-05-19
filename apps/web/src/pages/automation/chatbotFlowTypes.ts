export interface ChatbotFlowNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface ChatbotFlowEdge {
  id: string;
  source: string;
  target: string;
  branch?: string;
}

export interface ChatbotFlowDefinition {
  nodes: ChatbotFlowNode[];
  edges: ChatbotFlowEdge[];
}

export interface ChatbotFlowVariableDef {
  id: string;
  name: string;
  value?: string;
  isSessionVariable?: boolean;
}

export interface ChatbotFlowRow {
  id: string;
  name: string;
  description: string | null;
  publicId: string;
  isPublished: boolean;
  flowDefinition: ChatbotFlowDefinition;
  variables: ChatbotFlowVariableDef[];
  linkedBotId: string | null;
  linkedBot?: { id: string; name: string; isActive: boolean } | null;
  sessionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export const CHATBOT_BLOCK_TYPES = [
  "start",
  "text",
  "image",
  "text_input",
  "choice_input",
  "condition",
  "set_variable",
  "webhook",
  "add_tag",
  "handoff",
  "wait",
  "jump",
  "end",
] as const;

export function defaultChatbotFlow(): ChatbotFlowDefinition {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 20, y: 20 }, data: {} },
      {
        id: "welcome",
        type: "text",
        position: { x: 20, y: 100 },
        data: { content: "Olá {{contact.name}}! Como posso ajudar?" },
      },
      {
        id: "ask",
        type: "text_input",
        position: { x: 20, y: 180 },
        data: { variableName: "resposta", prompt: "Escreva a sua mensagem:" },
      },
      { id: "end", type: "end", position: { x: 20, y: 260 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "welcome" },
      { id: "e2", source: "welcome", target: "ask" },
      { id: "e3", source: "ask", target: "end" },
    ],
  };
}
