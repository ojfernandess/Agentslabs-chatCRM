import {
  DEFAULT_KNOWLEDGE_CHUNKING,
  DEFAULT_KNOWLEDGE_ENGINE_CONFIG,
  DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG,
  type KnowledgeChunkingConfig,
  type KnowledgeEngineConfig,
  type KnowledgeEngineOrgConfig,
  type KnowledgeProviderKind,
} from "./knowledgeEngineTypes.js";

const PROVIDER_KINDS = new Set<KnowledgeProviderKind>(["openconduit", "llamaindex"]);

function asProviderKind(v: unknown): KnowledgeProviderKind {
  return typeof v === "string" && PROVIDER_KINDS.has(v as KnowledgeProviderKind)
    ? (v as KnowledgeProviderKind)
    : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.provider;
}

function parseChunking(raw: unknown): KnowledgeChunkingConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_KNOWLEDGE_CHUNKING };
  const o = raw as Record<string, unknown>;
  return {
    chunkSize:
      typeof o.chunkSize === "number" && Number.isFinite(o.chunkSize)
        ? Math.min(4000, Math.max(200, Math.round(o.chunkSize)))
        : DEFAULT_KNOWLEDGE_CHUNKING.chunkSize,
    chunkOverlap:
      typeof o.chunkOverlap === "number" && Number.isFinite(o.chunkOverlap)
        ? Math.min(800, Math.max(0, Math.round(o.chunkOverlap)))
        : DEFAULT_KNOWLEDGE_CHUNKING.chunkOverlap,
    separator: typeof o.separator === "string" && o.separator.length > 0 ? o.separator : DEFAULT_KNOWLEDGE_CHUNKING.separator,
    autoChunk: o.autoChunk !== false,
    preserveHierarchy: o.preserveHierarchy !== false,
  };
}

/**
 * O runtime legado (Base de conhecimento IA) permanece intacto enquanto o provider for `openconduit`.
 * Só activa o Knowledge Engine quando o agente escolhe explicitamente LlamaIndex.
 */
export function shouldUseKnowledgeEngineRuntime(behaviorConfig: unknown): boolean {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return false;
  const beh = behaviorConfig as Record<string, unknown>;
  const raw = beh.knowledgeEngine;
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>).provider === "llamaindex";
}

/**
 * Lê `behaviorConfig.knowledgeEngine` com fallback para RAG legado (`nativeTools.knowledge_search`).
 */
export function parseKnowledgeEngineConfig(behaviorConfig: unknown): KnowledgeEngineConfig {
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return { ...DEFAULT_KNOWLEDGE_ENGINE_CONFIG };
  }
  const beh = behaviorConfig as Record<string, unknown>;
  const raw = beh.knowledgeEngine;
  const legacyKbEnabled =
    beh.nativeTools &&
    typeof beh.nativeTools === "object" &&
    (beh.nativeTools as Record<string, unknown>).knowledge_search !== false;

  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_KNOWLEDGE_ENGINE_CONFIG,
      enabled: legacyKbEnabled !== false,
    };
  }

  const o = raw as Record<string, unknown>;
  return {
    provider: asProviderKind(o.provider),
    enabled: o.enabled !== false && legacyKbEnabled !== false,
    semanticSearch: o.semanticSearch !== false,
    reranking: o.reranking !== false,
    citations: o.citations !== false,
    maxDocuments:
      typeof o.maxDocuments === "number" && Number.isFinite(o.maxDocuments)
        ? Math.min(50, Math.max(1, Math.round(o.maxDocuments)))
        : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.maxDocuments,
    maxChunks:
      typeof o.maxChunks === "number" && Number.isFinite(o.maxChunks)
        ? Math.min(100, Math.max(1, Math.round(o.maxChunks)))
        : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.maxChunks,
    searchTemperature:
      typeof o.searchTemperature === "number" && Number.isFinite(o.searchTemperature)
        ? Math.min(1, Math.max(0, o.searchTemperature))
        : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.searchTemperature,
    minScore:
      typeof o.minScore === "number" && Number.isFinite(o.minScore)
        ? Math.min(1, Math.max(0, o.minScore))
        : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.minScore,
    minSimilarity:
      typeof o.minSimilarity === "number" && Number.isFinite(o.minSimilarity)
        ? Math.min(1, Math.max(0, o.minSimilarity))
        : DEFAULT_KNOWLEDGE_ENGINE_CONFIG.minSimilarity,
    chunking: parseChunking(o.chunking),
  };
}

export function mergeKnowledgeEngineIntoBehavior(
  behaviorConfig: Record<string, unknown>,
  engine: KnowledgeEngineConfig,
): Record<string, unknown> {
  return {
    ...behaviorConfig,
    knowledgeEngine: {
      provider: engine.provider,
      enabled: engine.enabled,
      semanticSearch: engine.semanticSearch,
      reranking: engine.reranking,
      citations: engine.citations,
      maxDocuments: engine.maxDocuments,
      maxChunks: engine.maxChunks,
      searchTemperature: engine.searchTemperature,
      minScore: engine.minScore,
      minSimilarity: engine.minSimilarity,
      chunking: engine.chunking,
    },
    nativeTools: {
      ...(behaviorConfig.nativeTools && typeof behaviorConfig.nativeTools === "object"
        ? (behaviorConfig.nativeTools as Record<string, unknown>)
        : {}),
      knowledge_search: engine.enabled,
    },
  };
}

export function orgKnowledgeStoreKey(organizationId: string): string {
  return `knowledge_engine_org:${organizationId}`;
}

export function parseOrgKnowledgeStore(raw: unknown): {
  config: KnowledgeEngineOrgConfig;
  updatedAt: string;
} {
  if (!raw || typeof raw !== "object") {
    return { config: { ...DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG }, updatedAt: new Date().toISOString() };
  }
  const o = raw as Record<string, unknown>;
  const cfg = o.config && typeof o.config === "object" ? (o.config as Record<string, unknown>) : {};
  return {
    config: {
      provider: asProviderKind(cfg.provider),
      maxDocuments:
        typeof cfg.maxDocuments === "number" ? Math.min(50, Math.max(1, cfg.maxDocuments)) : DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG.maxDocuments,
      maxChunks:
        typeof cfg.maxChunks === "number" ? Math.min(100, Math.max(1, cfg.maxChunks)) : DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG.maxChunks,
      minScore:
        typeof cfg.minScore === "number" ? Math.min(1, Math.max(0, cfg.minScore)) : DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG.minScore,
      minSimilarity:
        typeof cfg.minSimilarity === "number"
          ? Math.min(1, Math.max(0, cfg.minSimilarity))
          : DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG.minSimilarity,
      autoIndex: cfg.autoIndex !== false,
      cacheEnabled: cfg.cacheEnabled !== false,
      reranking: cfg.reranking !== false,
      citations: cfg.citations !== false,
    },
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}
