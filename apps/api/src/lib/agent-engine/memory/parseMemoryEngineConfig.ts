import type { AgentMemoryKind } from "../types.js";
import {
  DEFAULT_MEMORY_ENGINE_CONFIG,
  DEFAULT_MEMORY_ENGINE_ORG_CONFIG,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryEngineConfig,
  type MemoryEngineOrgConfig,
  type MemoryRecord,
  type OrgMemoryStore,
} from "./memoryEngineTypes.js";

const MEMORY_KINDS = new Set<AgentMemoryKind>(["openconduit", "mem0"]);

function asMemoryKind(v: unknown, fallback: AgentMemoryKind): AgentMemoryKind {
  return typeof v === "string" && MEMORY_KINDS.has(v as AgentMemoryKind)
    ? (v as AgentMemoryKind)
    : fallback;
}

function asCategory(v: unknown): MemoryCategory | null {
  return typeof v === "string" && MEMORY_CATEGORIES.includes(v as MemoryCategory)
    ? (v as MemoryCategory)
    : null;
}

function asCategories(raw: unknown, fallback: MemoryCategory[]): MemoryCategory[] {
  if (!Array.isArray(raw)) return fallback;
  const out = raw.map(asCategory).filter((x): x is MemoryCategory => x != null);
  return out.length > 0 ? out : fallback;
}

/**
 * Lê `behaviorConfig.memoryEngine` com fallback para `agentEngine.memory`.
 * Agentes legados sem bloco memoryEngine mantêm comportamento OpenNexo.
 */
export function parseMemoryEngineConfig(behaviorConfig: unknown): MemoryEngineConfig {
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return { ...DEFAULT_MEMORY_ENGINE_CONFIG };
  }
  const beh = behaviorConfig as Record<string, unknown>;
  const agentEngine =
    beh.agentEngine && typeof beh.agentEngine === "object"
      ? (beh.agentEngine as Record<string, unknown>)
      : null;
  const legacyProvider = asMemoryKind(agentEngine?.memory, DEFAULT_MEMORY_ENGINE_CONFIG.provider);

  const raw = beh.memoryEngine;
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_MEMORY_ENGINE_CONFIG,
      provider: legacyProvider,
    };
  }
  const o = raw as Record<string, unknown>;
  const maxMemories =
    typeof o.maxMemories === "number" && Number.isFinite(o.maxMemories)
      ? Math.min(500, Math.max(10, Math.round(o.maxMemories)))
      : DEFAULT_MEMORY_ENGINE_CONFIG.maxMemories;

  return {
    provider: asMemoryKind(o.provider, legacyProvider),
    intelligentMemoryEnabled: o.intelligentMemoryEnabled !== false,
    autoSaveEnabled: o.autoSaveEnabled !== false,
    rememberPreferences: o.rememberPreferences !== false,
    rememberCommercialHistory: o.rememberCommercialHistory !== false,
    rememberTechnicalData: o.rememberTechnicalData !== false,
    ignoreCasualConversations: o.ignoreCasualConversations !== false,
    maxMemories,
  };
}

export function mergeMemoryEngineIntoBehavior(
  behaviorConfig: Record<string, unknown>,
  memoryEngine: MemoryEngineConfig,
): Record<string, unknown> {
  const agentEngine =
    behaviorConfig.agentEngine && typeof behaviorConfig.agentEngine === "object"
      ? (behaviorConfig.agentEngine as Record<string, unknown>)
      : {};
  return {
    ...behaviorConfig,
    memoryEngine: {
      provider: memoryEngine.provider,
      intelligentMemoryEnabled: memoryEngine.intelligentMemoryEnabled,
      autoSaveEnabled: memoryEngine.autoSaveEnabled,
      rememberPreferences: memoryEngine.rememberPreferences,
      rememberCommercialHistory: memoryEngine.rememberCommercialHistory,
      rememberTechnicalData: memoryEngine.rememberTechnicalData,
      ignoreCasualConversations: memoryEngine.ignoreCasualConversations,
      maxMemories: memoryEngine.maxMemories,
    },
    agentEngine: {
      ...agentEngine,
      memory: memoryEngine.provider,
    },
  };
}

export function parseOrgMemoryStore(raw: unknown): OrgMemoryStore {
  if (!raw || typeof raw !== "object") {
    return {
      config: { ...DEFAULT_MEMORY_ENGINE_ORG_CONFIG },
      globalMemories: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const o = raw as Record<string, unknown>;
  const cfgRaw = o.config && typeof o.config === "object" ? (o.config as Record<string, unknown>) : {};
  const config: MemoryEngineOrgConfig = {
    mem0Enabled: cfgRaw.mem0Enabled === true,
    provider: asMemoryKind(cfgRaw.provider, DEFAULT_MEMORY_ENGINE_ORG_CONFIG.provider),
    maxMemories:
      typeof cfgRaw.maxMemories === "number"
        ? Math.min(500, Math.max(10, Math.round(cfgRaw.maxMemories)))
        : DEFAULT_MEMORY_ENGINE_ORG_CONFIG.maxMemories,
    retentionDays:
      typeof cfgRaw.retentionDays === "number"
        ? Math.min(3650, Math.max(1, Math.round(cfgRaw.retentionDays)))
        : DEFAULT_MEMORY_ENGINE_ORG_CONFIG.retentionDays,
    allowedCategories: asCategories(cfgRaw.allowedCategories, DEFAULT_MEMORY_ENGINE_ORG_CONFIG.allowedCategories),
    blockedCategories: asCategories(cfgRaw.blockedCategories, []),
    minScore:
      typeof cfgRaw.minScore === "number"
        ? Math.min(1, Math.max(0, cfgRaw.minScore))
        : DEFAULT_MEMORY_ENGINE_ORG_CONFIG.minScore,
    minConfidence:
      typeof cfgRaw.minConfidence === "number"
        ? Math.min(1, Math.max(0, cfgRaw.minConfidence))
        : DEFAULT_MEMORY_ENGINE_ORG_CONFIG.minConfidence,
    autoSummarize: cfgRaw.autoSummarize !== false,
    autoCleanup: cfgRaw.autoCleanup !== false,
  };
  const globalMemories = Array.isArray(o.globalMemories)
    ? (o.globalMemories as MemoryRecord[]).filter((m) => m && typeof m.text === "string")
    : [];
  return {
    config,
    globalMemories,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}

export function orgMemoryStoreKey(organizationId: string): string {
  return `memory_engine_org:${organizationId}`;
}
