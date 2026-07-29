/**
 * Durable Workflow / Step Engine (Fase 3 — Mastra-inspired).
 * Declaração tipada: branch, loop, suspend/resume, compensation.
 * Não substitui LangGraph; corre ao lado da ExecutionEngine quando activado.
 */

export type WorkflowStepKind =
  | "noop"
  | "set_var"
  | "tool"
  | "branch"
  | "loop"
  | "suspend"
  | "fail";

/** Predicado sobre vars do run (facts/slots já materializados em vars). */
export type WorkflowCondition = {
  /** Chave em `state.vars` (suporta `a.b` raso). */
  var?: string;
  /** Igualdade estrita. */
  eq?: unknown;
  /** Verdadeiro se a var existe e é truthy. */
  truthy?: boolean;
  /** Negar o resultado da condição. */
  not?: boolean;
};

export type WorkflowStep = {
  id: string;
  kind: WorkflowStepKind;
  /** Próximo step (default: ordem implícita via `next`). */
  next?: string | null;
  /** set_var */
  varName?: string;
  varValue?: unknown;
  /** tool — nome canónico; execução via handler injectável. */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** branch */
  when?: WorkflowCondition;
  then?: string;
  else?: string;
  /** loop — corpo + condição de saída + máximo */
  body?: string;
  until?: WorkflowCondition;
  maxIterations?: number;
  /** suspend — pausa durável */
  suspendReason?: string;
  resumeOn?: "hitl" | "next_message" | "manual";
  /** fail — força falha (teste / guard) */
  failMessage?: string;
  /**
   * Step a correr em compensação (LIFO) se um step posterior falhar
   * depois deste ter concluído com sucesso.
   */
  compensateWith?: string;
};

export type WorkflowDefinition = {
  version: 1;
  id: string;
  entry: string;
  steps: Record<string, WorkflowStep>;
  /** Metadata opcional. */
  label?: string;
};

export type WorkflowRunStatus =
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

export type WorkflowRunState = {
  version: 1;
  workflowId: string;
  runId: string;
  organizationId?: string;
  conversationId?: string;
  status: WorkflowRunStatus;
  currentStepId: string | null;
  /** Steps concluídos com sucesso (ordem). */
  completedStepIds: string[];
  /** IDs de steps de compensação a correr em LIFO. */
  compensationStack: string[];
  iterationCounts: Record<string, number>;
  vars: Record<string, unknown>;
  /** Tools pedidas pelo workflow (para Scheduler / Engine). */
  plannedToolNames: string[];
  toolResults: Array<{ name: string; ok: boolean; result?: unknown; error?: string }>;
  suspendReason?: string;
  resumeOn?: "hitl" | "next_message" | "manual";
  error?: string;
  updatedAt: string;
  createdAt: string;
};

export type WorkflowStepHandlers = {
  /** Invoca tool HTTP/nativa. Se omitido, tool steps só registam plannedToolNames. */
  onTool?: (
    step: WorkflowStep,
    state: WorkflowRunState,
  ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
};

export type WorkflowAdvanceResult = {
  state: WorkflowRunState;
  /** true se o run parou (complete / suspend / fail / compensated). */
  done: boolean;
};
