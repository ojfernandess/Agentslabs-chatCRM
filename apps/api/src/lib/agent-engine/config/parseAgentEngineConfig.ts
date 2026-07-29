import {
  DEFAULT_AGENT_ENGINE_CONFIG,
  type AgentEngineConfig,
  type AgentCheckpointStoreKind,
  type AgentMemoryKind,
  type AgentObservabilityLevel,
  type AgentRuntimeKind,
  type AgentSupervisorMode,
} from "../types.js";

const RUNTIME_KINDS = new Set<AgentRuntimeKind>([
  "openconduit",
  "langgraph",
  "crewai",
  "autogen",
  "mastra",
]);

const MEMORY_KINDS = new Set<AgentMemoryKind>(["openconduit", "mem0"]);

const OBS_LEVELS = new Set<AgentObservabilityLevel>(["basic", "full"]);

function asRuntimeKind(v: unknown): AgentRuntimeKind {
  return typeof v === "string" && RUNTIME_KINDS.has(v as AgentRuntimeKind)
    ? (v as AgentRuntimeKind)
    : DEFAULT_AGENT_ENGINE_CONFIG.runtime;
}

function asMemoryKind(v: unknown): AgentMemoryKind {
  return typeof v === "string" && MEMORY_KINDS.has(v as AgentMemoryKind)
    ? (v as AgentMemoryKind)
    : DEFAULT_AGENT_ENGINE_CONFIG.memory;
}

function asObsLevel(v: unknown): AgentObservabilityLevel {
  return typeof v === "string" && OBS_LEVELS.has(v as AgentObservabilityLevel)
    ? (v as AgentObservabilityLevel)
    : DEFAULT_AGENT_ENGINE_CONFIG.observability;
}

function asCheckpointStore(v: unknown): AgentCheckpointStoreKind {
  return v === "redis" ? "redis" : "memory";
}

function asSupervisorMode(v: unknown): AgentSupervisorMode {
  if (v === "structural" || v === "llm" || v === "both") return v;
  return DEFAULT_AGENT_ENGINE_CONFIG.supervisorMode ?? "both";
}

/**
 * Lê `behaviorConfig.agentEngine` com fallback seguro para agentes legados.
 * Também mapeia `agentSupervisor.enabled` quando supervisorEnabled não está definido.
 */
export function parseAgentEngineConfig(behaviorConfig: unknown): AgentEngineConfig {
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return { ...DEFAULT_AGENT_ENGINE_CONFIG };
  }
  const beh = behaviorConfig as Record<string, unknown>;
  const raw = beh.agentEngine;
  const legacySupervisor: boolean =
    Boolean(
      beh.agentSupervisor &&
        typeof beh.agentSupervisor === "object" &&
        (beh.agentSupervisor as Record<string, unknown>).enabled === true,
    );

  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_AGENT_ENGINE_CONFIG,
      supervisorEnabled: legacySupervisor,
    };
  }
  const o = raw as Record<string, unknown>;
  const supervisorEnabled =
    o.supervisorEnabled === true ||
    (o.supervisorEnabled !== false && legacySupervisor);
  return {
    runtime: asRuntimeKind(o.runtime),
    memory: asMemoryKind(o.memory),
    supervisorEnabled,
    supervisorMode: supervisorEnabled ? asSupervisorMode(o.supervisorMode) : "both",
    strictMode: o.strictMode === true,
    observability: asObsLevel(o.observability),
    checkpointStore: asCheckpointStore(o.checkpointStore),
    streamingEnabled: o.streamingEnabled === true,
    humanInTheLoopEnabled: o.humanInTheLoopEnabled === true,
    humanInTheLoopNativeEnabled: o.humanInTheLoopNativeEnabled === true,
    executionQueueEnabled: o.executionQueueEnabled === true,
    clientTokenStreamingEnabled: o.clientTokenStreamingEnabled === true,
    clientOutboundStreamingEnabled: o.clientOutboundStreamingEnabled === true,
    parallelKbPrefetchEnabled: o.parallelKbPrefetchEnabled === true,
    schedulerEnabled: o.schedulerEnabled === true,
    resilienceEnabled: o.resilienceEnabled === true,
    legacyOpenconduitBypass: o.legacyOpenconduitBypass === true,
    workflowEngineEnabled: o.workflowEngineEnabled === true,
    memoryBudgetEnabled: o.memoryBudgetEnabled === true,
    memoryTokenBudget:
      typeof o.memoryTokenBudget === "number" && Number.isFinite(o.memoryTokenBudget)
        ? Math.min(8000, Math.max(64, Math.round(o.memoryTokenBudget)))
        : DEFAULT_AGENT_ENGINE_CONFIG.memoryTokenBudget,
    memoryDefaultTtlSeconds:
      typeof o.memoryDefaultTtlSeconds === "number" && Number.isFinite(o.memoryDefaultTtlSeconds)
        ? Math.min(60 * 60 * 24 * 30, Math.max(0, Math.round(o.memoryDefaultTtlSeconds)))
        : DEFAULT_AGENT_ENGINE_CONFIG.memoryDefaultTtlSeconds,
    otelEnabled: o.otelEnabled === true,
    simulatorEnabled: o.simulatorEnabled === true,
  };
}

export function mergeAgentEngineIntoBehavior(
  behaviorConfig: Record<string, unknown>,
  engine: AgentEngineConfig,
): Record<string, unknown> {
  return {
    ...behaviorConfig,
    agentEngine: {
      runtime: engine.runtime,
      memory: engine.memory,
      supervisorEnabled: engine.supervisorEnabled,
      supervisorMode: engine.supervisorMode ?? "both",
      strictMode: engine.strictMode,
      observability: engine.observability,
      checkpointStore: engine.checkpointStore ?? "memory",
      streamingEnabled: engine.streamingEnabled ?? false,
      humanInTheLoopEnabled: engine.humanInTheLoopEnabled ?? false,
      humanInTheLoopNativeEnabled: engine.humanInTheLoopNativeEnabled ?? false,
      executionQueueEnabled: engine.executionQueueEnabled ?? false,
      clientTokenStreamingEnabled: engine.clientTokenStreamingEnabled ?? false,
      clientOutboundStreamingEnabled: engine.clientOutboundStreamingEnabled ?? false,
      parallelKbPrefetchEnabled: engine.parallelKbPrefetchEnabled ?? false,
      schedulerEnabled: engine.schedulerEnabled ?? false,
      resilienceEnabled: engine.resilienceEnabled ?? false,
      legacyOpenconduitBypass: engine.legacyOpenconduitBypass ?? false,
      workflowEngineEnabled: engine.workflowEngineEnabled ?? false,
      memoryBudgetEnabled: engine.memoryBudgetEnabled ?? false,
      memoryTokenBudget: engine.memoryTokenBudget ?? 1200,
      memoryDefaultTtlSeconds: engine.memoryDefaultTtlSeconds ?? 0,
      otelEnabled: engine.otelEnabled ?? false,
      simulatorEnabled: engine.simulatorEnabled ?? false,
    },
    agentSupervisor: {
      ...(behaviorConfig.agentSupervisor &&
      typeof behaviorConfig.agentSupervisor === "object"
        ? (behaviorConfig.agentSupervisor as Record<string, unknown>)
        : {}),
      enabled: engine.supervisorEnabled,
    },
  };
}
