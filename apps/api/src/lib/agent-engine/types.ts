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
  /** Invoca tools obrigatórias antes do LLM (Tool Scheduler — Fase 2). */
  schedulerEnabled?: boolean;
  /**
   * Quem executa tools no Motor Padrão:
   * - runtime_owned: só Scheduler (LLM reply-only)
   * - hybrid: Scheduler pré-executa Required; LLM ainda pode chamar tools
   */
  toolExecutionMode?: "runtime_owned" | "hybrid";
  /** Recovery de tools + fallback + self-healing (Fase 4). */
  resilienceEnabled?: boolean;
  /**
   * @deprecated Motor Padrão usa sempre loop linear sandbox; esta flag deixou de ter efeito.
   */
  legacyOpenconduitBypass?: boolean;
  /**
   * Unified Execution Spine (Fase 2):
   * - off: sem ExecutionEngine no path openconduit (default)
   * - shadow: beginTurn + compare com legacy (legacy entrega)
   * - primary: TurnContext do ExecutionEngine
   * - only: engine exclusivo; sem buildTurnContext legacy (Fase 2c)
   * Override: env AGENT_ENGINE_UNIFIED_SPINE=shadow|primary|only|off
   */
  unifiedSpineMode?: "off" | "shadow" | "primary" | "only";
  /**
   * Workflow/Step Engine durável (branch/loop/suspend/compensate).
   * Requer `behaviorConfig.agentEngine.workflow` definition.
   */
  workflowEngineEnabled?: boolean;
  /**
   * @deprecated Shared orchestrator spine removido do path de produção.
   * LangGraph usa StateGraph agent↔tools; Motor Padrão usa loop linear sandbox.
   * Flag ignorada se true (mantida só para compatibilidade de config legada).
   */
  workflowRuntimeShared?: boolean;
  /** Fase 4 — packing de memória com TTL/prioridade/token budget. */
  memoryBudgetEnabled?: boolean;
  /** Orçamento de tokens do appendix de memória (quando memoryBudgetEnabled). */
  memoryTokenBudget?: number;
  /** TTL default (s) para memória temporary. */
  memoryDefaultTtlSeconds?: number;
  /** Exporta spans OTEL (OTLP se endpoint env; sempre buffer local). */
  otelEnabled?: boolean;
  /** Permite dry-run via AgentTurnSimulator (flag documental / gate de API). */
  simulatorEnabled?: boolean;
  /**
   * Após tool de conclusão OK (ex. check_in) + ack curto, agenda um 2.º turno
   * sintético (Passo 8 / KB) sem esperar resposta do contacto. Default false.
   */
  postCompletionFollowUpEnabled?: boolean;
  /** Texto do inbound sintético do follow-up (default não-confirmação). */
  postCompletionFollowUpSyntheticText?: string;
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
  schedulerEnabled: false,
  toolExecutionMode: "hybrid",
  resilienceEnabled: false,
  legacyOpenconduitBypass: false,
  unifiedSpineMode: "off",
  workflowEngineEnabled: false,
  workflowRuntimeShared: false,
  memoryBudgetEnabled: false,
  memoryTokenBudget: 1200,
  memoryDefaultTtlSeconds: 0,
  otelEnabled: false,
  simulatorEnabled: false,
  postCompletionFollowUpEnabled: false,
  postCompletionFollowUpSyntheticText: "envie os detalhes da estadia",
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
    /** Tools já invocadas pelo Tool Scheduler neste turno — LLM não deve repetir. */
    preScheduledToolOutcomes?: Array<{
      name: string;
      ok: boolean;
      preview: string;
      structuredPayload?: unknown;
    }>;
    /**
     * runtime_owned: não expor tools ao LLM (só texto).
     * hybrid / omitido: comportamento clássico com function-calling.
     */
    toolExecutionMode?: "runtime_owned" | "hybrid";
  };
};

export type AgentRuntimeExecuteResult = {
  reply: string;
  trace?: AgentExecutionTrace;
  /** Outcomes do turno (para follow-up pós-conclusão / inspectores). */
  toolOutcomes?: Array<{
    name: string;
    ok: boolean;
    preview: string;
    structuredPayload?: unknown;
  }>;
};

export type AgentGraphNodeId =
  | "classify_intent"
  | "fan_out_kb"
  | "kb_read_node"
  | "merge_kb_results"
  | "load_memory"
  | "schedule_tools"
  | "select_tool"
  | "execute_tool"
  | "validate_result"
  | "supervisor"
  | "update_memory"
  | "respond"
  | "human_review"
  | "agent"
  | "tools";

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
  | "token"
  | "turn_context"
  | "workflow_engine"
  | "spine";

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
  /** Execution Intelligence Layer snapshot (auditoria / MCP). */
  eil?: {
    enabled: boolean;
    plan?: unknown;
    facts: Record<string, unknown>;
    capabilitiesUsed: string[];
    policiesApplied: string[];
    violations: unknown[];
    toolsCalled: string[];
    toolsPending: string[];
    replyActions?: string[];
  };
  /** TurnContext / ExecutionContract (Fase 5 — MCP turn/contract). */
  turn?: {
    version: number;
    userMessage: string;
    intentKind?: string;
    intentConfidence?: number;
    promptHash?: string;
    objective?: string;
    requiredToolNames: string[];
    pendingToolNames: string[];
    satisfiedToolNames: string[];
    forbiddenToolNames: string[];
    planPhase?: string;
    contractValid: boolean;
    violations: string[];
    eilEnabled?: boolean;
  };
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
  /** Fase 5 — violações com camada upstream para RCA (MCP). */
  routedViolations?: Array<{
    id: string;
    message: string;
    layer: string;
    component: string;
    rcaHint: string;
  }>;
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
