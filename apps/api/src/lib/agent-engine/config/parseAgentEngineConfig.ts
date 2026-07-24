import {
  DEFAULT_AGENT_ENGINE_CONFIG,
  type AgentEngineConfig,
  type AgentMemoryKind,
  type AgentObservabilityLevel,
  type AgentRuntimeKind,
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
    strictMode: o.strictMode === true,
    observability: asObsLevel(o.observability),
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
      strictMode: engine.strictMode,
      observability: engine.observability,
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
