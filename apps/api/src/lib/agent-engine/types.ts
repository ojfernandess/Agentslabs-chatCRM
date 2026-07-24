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

/** Nível de observabilidade. */
export type AgentObservabilityLevel = "basic" | "full";

/** Configuração persistida em `behaviorConfig.agentEngine`. */
export type AgentEngineConfig = {
  runtime: AgentRuntimeKind;
  memory: AgentMemoryKind;
  supervisorEnabled: boolean;
  strictMode: boolean;
  observability: AgentObservabilityLevel;
};

export const DEFAULT_AGENT_ENGINE_CONFIG: AgentEngineConfig = {
  runtime: "openconduit",
  memory: "openconduit",
  supervisorEnabled: false,
  strictMode: false,
  observability: "basic",
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
};

export type AgentRuntimeExecuteResult = {
  reply: string;
  trace?: AgentExecutionTrace;
};

export type AgentGraphNodeId =
  | "classify_intent"
  | "load_memory"
  | "select_tool"
  | "execute_tool"
  | "validate_result"
  | "supervisor"
  | "update_memory"
  | "respond";

export type AgentExecutionTrace = {
  runtime: AgentRuntimeKind;
  memory: AgentMemoryKind;
  strictMode: boolean;
  observability: AgentObservabilityLevel;
  currentNode?: AgentGraphNodeId;
  nextNode?: AgentGraphNodeId;
  nodes: AgentTraceNode[];
  supervisor?: AgentSupervisorTrace;
  memorySnapshot?: Record<string, unknown>;
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
