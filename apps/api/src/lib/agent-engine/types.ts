import type { Bot, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { AutomationExecutionLogPort } from "../automationExecutionLog.js";
import type { PreviewChatTurn } from "../promptModulePreviewLlm.js";

/** Motores de execução suportados (extensível via Factory). */
export type AgentRuntimeKind =
  | "openconduit"
  | "langgraph"
  | "crewai"
  | "autogen"
  | "mastra";

/** Provedores de memória. */
export type AgentMemoryKind = "openconduit" | "mem0";

/** Store de checkpoint LangGraph. */
export type AgentCheckpointStoreKind = "memory" | "redis";

/** Modo do supervisor quando `supervisorEnabled`. */
export type AgentSupervisorMode = "structural" | "llm" | "both";

/** Nível de observabilidade. */
export type AgentObservabilityLevel = "basic" | "full";

/** Configuração persistida em `behaviorConfig.agentEngine`. */
export type AgentEngineConfig = {
  runtime: AgentRuntimeKind;
  memory: AgentMemoryKind;
  supervisorEnabled: boolean;
  /** Default `both` quando supervisor activo (retrocompatível). */
  supervisorMode?: AgentSupervisorMode;
  strictMode: boolean;
  observability: AgentObservabilityLevel;
  /** Checkpoint LangGraph — default `memory` (in-process). */
  checkpointStore?: AgentCheckpointStoreKind;
  /** Usa `graph.stream()` e emite eventos parciais no execution log. */
  streamingEnabled?: boolean;
  /** Pausa envio quando supervisor reprova — fila HITL via API. */
  humanInTheLoopEnabled?: boolean;
  /** Usa `interrupt()` LangGraph + resume via `Command` (requer checkpoint). */
  humanInTheLoopNativeEnabled?: boolean;
  /** Enfileira respostas inbound em BullMQ (requer REDIS_URL). */
  executionQueueEnabled?: boolean;
  /** Publica tokens LLM no event bus SSE (`kind: token`). */
  clientTokenStreamingEnabled?: boolean;
  /** Envia chunks de texto ao contacto durante geração LLM (WhatsApp). */
  clientOutboundStreamingEnabled?: boolean;
  /** Prefetch KB paralelo via LangGraph Send (artigos pinned). */
  parallelKbPrefetchEnabled?: boolean;
};

export const DEFAULT_AGENT_ENGINE_CONFIG: AgentEngineConfig = {
  runtime: "openconduit",
  memory: "openconduit",
  supervisorEnabled: false,
  supervisorMode: "both",
  strictMode: false,
  observability: "basic",
  checkpointStore: "memory",
  streamingEnabled: false,
  humanInTheLoopEnabled: false,
  humanInTheLoopNativeEnabled: false,
  executionQueueEnabled: false,
  clientTokenStreamingEnabled: false,
  clientOutboundStreamingEnabled: false,
  parallelKbPrefetchEnabled: false,
};

export type AgentRuntimeExecuteInput = {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  message: Message;
  log: FastifyBaseLogger;
  executionLog?: AutomationExecutionLogPort | null;
  historyOverride?: PreviewChatTurn[];
  contactId?: string;
  engineConfig: AgentEngineConfig;
  llmConfig: Record<string, unknown>;
  behaviorConfig: Record<string, unknown>;
  /** Appendix KB pré-carregado pelo grafo (Send API parallel prefetch). */
  kbPrefetchAppendix?: string;
  /**
   * Hints de execução do Agent Engine (retry reply-only, reuso de tools).
   * Genérico — não específico de segmento/agente.
   */
  executionHints?: {
    /** Regenerar só a resposta — não reexecutar tools HTTP já bem-sucedidas. */
    replyOnlyRetry?: boolean;
    /** Outcomes do turno anterior (mesmo user message) a reutilizar. */
    priorSuccessfulToolOutcomes?: Array<{ name: string; ok: boolean; preview: string }>;
  };
};

export type AgentRuntimeExecuteResult = {
  reply: string;
  trace?: AgentExecutionTrace;
};

export type AgentGraphNodeId =
  | "classify_intent"
  | "fan_out_kb"
  | "kb_read_node"
  | "merge_kb_results"
  | "load_memory"
  | "select_tool"
  | "execute_tool"
  | "validate_result"
  | "supervisor"
  | "update_memory"
  | "respond"
  | "human_review";

export type AgentGraphEventKind =
  | "start"
  | "end"
  | "node"
  | "edge"
  | "tool"
  | "memory"
  | "knowledge"
  | "supervisor"
  | "error"
  | "retry"
  | "checkpoint"
  | "stream"
  | "hitl"
  | "token";

export type AgentGraphEvent = {
  kind: AgentGraphEventKind;
  at: string;
  nodeId?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
};

export type AgentExecutionTrace = {
  runtime: AgentRuntimeKind;
  memory: AgentMemoryKind;
  strictMode: boolean;
  observability: AgentObservabilityLevel;
  currentNode?: AgentGraphNodeId;
  nextNode?: AgentGraphNodeId;
  nodes: AgentTraceNode[];
  events?: AgentGraphEvent[];
  supervisor?: AgentSupervisorTrace;
  memorySnapshot?: Record<string, unknown>;
  hitlPendingId?: string;
  checkpointThreadId?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
  latencyMs?: number;
  errors: string[];
};

export type AgentTraceNode = {
  id: AgentGraphNodeId | string;
  name: string;
  status: "ok" | "warn" | "error" | "skipped";
  startedAt: string;
  endedAt?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
};

export type AgentSupervisorTrace = {
  approved: boolean;
  summary: string;
  checks: AgentSupervisorCheck[];
  retryCount: number;
};

export type AgentSupervisorCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type ToolValidationResult = {
  ok: boolean;
  blockSend: boolean;
  alerts: string[];
  fallbackSuggested: boolean;
};

export type PromptValidationResult = {
  score: number;
  maxScore: number;
  checks: Array<{ id: string; label: string; passed: boolean; weight: number; detail?: string }>;
  ready: boolean;
};

export type AgentRuntimeState = {
  status: "idle" | "running" | "paused" | "interrupted" | "completed" | "failed";
  checkpointId?: string;
  currentNode?: AgentGraphNodeId | string;
  graphHistory: Array<AgentGraphNodeId | string>;
};
