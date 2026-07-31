/**
 * Critérios de conclusão e templates de resposta declarados no playbook.
 */

export type ToolSpec = {
  name: string;
  role: "catalog" | "required" | "optional" | "forbidden";
  category?: string;
};

export type CompletionCriterion = {
  id: string;
  description: string;
  toolNames?: string[];
};

export type ReplyTemplateTrigger =
  | "after_tool_success"
  | "on_stall"
  | "on_completion"
  | "step_reply";

export type ReplyTemplateSpec = {
  id: string;
  trigger: ReplyTemplateTrigger;
  /** Padrão genérico de tool (ex. consultar_reserva) — não nome fixo de cliente */
  bindToolPattern?: string;
  label: string;
  /** Excerpt do playbook que descreve o template */
  playbookExcerpt?: string;
};

export type TurnPatternSpec = {
  id: string;
  /** Referência ao registo genérico (GENERIC_TURN_PATTERNS) */
  registryId: string;
};
