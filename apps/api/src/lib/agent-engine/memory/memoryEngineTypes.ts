import type { AgentMemoryKind } from "../types.js";

/** Categorias de memória suportadas pelo OpenNexo Memory Engine. */
export type MemoryCategory =
  | "preferences"
  | "commercial_history"
  | "technical_data"
  | "profile"
  | "products"
  | "financial"
  | "hotel"
  | "reservation"
  | "support"
  | "company"
  | "knowledge"
  | "temporary";

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "preferences",
  "commercial_history",
  "technical_data",
  "profile",
  "products",
  "financial",
  "hotel",
  "reservation",
  "support",
  "company",
  "knowledge",
  "temporary",
];

export type MemoryOrigin = "agent" | "manual" | "system" | "import";

export type MemoryStatus = "active" | "pinned" | "archived";

export type MemoryScope = "temporary" | "contact" | "agent" | "global";

/** Registo normalizado de memória (OpenNexo + adapters externos). */
export type MemoryRecord = {
  id: string;
  category: MemoryCategory;
  text: string;
  origin: MemoryOrigin;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
  status: MemoryStatus;
  scope: MemoryScope;
  score: number;
  metadata?: Record<string, unknown>;
};

export type MemorySearchQuery = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  query?: string;
  categories?: MemoryCategory[];
  limit?: number;
  minConfidence?: number;
  minScore?: number;
  includeArchived?: boolean;
};

export type MemorySaveInput = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  record: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "lastUsedAt" | "useCount"> & {
    id?: string;
  };
};

export type MemoryUpdateInput = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  id: string;
  patch: Partial<
    Pick<MemoryRecord, "text" | "category" | "confidence" | "status" | "score" | "metadata">
  >;
};

export type MemoryDeleteInput = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  id: string;
};

export type MemoryListInput = Omit<MemorySearchQuery, "query">;

export type MemoryClearInput = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  categories?: MemoryCategory[];
};

export type MemorySummarizeInput = {
  organizationId: string;
  scope: MemoryScope;
  scopeId?: string | null;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
  maxItems?: number;
};

export type MemoryExecutionContextInput = {
  organizationId: string;
  conversationId: string;
  botId: string;
  contactId?: string | null;
  userMessage: string;
  config: MemoryEngineConfig;
  providerKind: AgentMemoryKind;
};

export type MemoryExecutionContext = {
  appendix: string;
  records: MemoryRecord[];
  hierarchy: {
    temporary: MemoryRecord[];
    contact: MemoryRecord[];
    agent: MemoryRecord[];
    global: MemoryRecord[];
  };
  loadedCount: number;
  latencyMs: number;
};

export type MemoryTurnSaveInput = {
  organizationId: string;
  conversationId: string;
  botId: string;
  contactId?: string | null;
  userMessage: string;
  assistantMessage: string;
  config: MemoryEngineConfig;
};

export type MemoryTurnSaveResult = {
  created: MemoryRecord[];
  updated: MemoryRecord[];
  skipped: number;
  events: MemoryObservabilityEvent[];
};

export type MemoryObservabilityEvent = {
  action: "loaded" | "used" | "created" | "updated" | "deleted" | "summarized";
  scope: MemoryScope;
  category?: MemoryCategory;
  origin?: MemoryOrigin;
  memoryId?: string;
  count?: number;
  latencyMs?: number;
  tokensEstimate?: number;
};

/** Configuração por agente (`behaviorConfig.memoryEngine`). */
export type MemoryEngineConfig = {
  provider: AgentMemoryKind;
  intelligentMemoryEnabled: boolean;
  autoSaveEnabled: boolean;
  rememberPreferences: boolean;
  rememberCommercialHistory: boolean;
  rememberTechnicalData: boolean;
  ignoreCasualConversations: boolean;
  maxMemories: number;
};

export const DEFAULT_MEMORY_ENGINE_CONFIG: MemoryEngineConfig = {
  provider: "openconduit",
  intelligentMemoryEnabled: true,
  autoSaveEnabled: true,
  rememberPreferences: true,
  rememberCommercialHistory: true,
  rememberTechnicalData: true,
  ignoreCasualConversations: true,
  maxMemories: 100,
};

/** Configuração administrativa da organização. */
export type MemoryEngineOrgConfig = {
  mem0Enabled: boolean;
  provider: AgentMemoryKind;
  maxMemories: number;
  retentionDays: number;
  allowedCategories: MemoryCategory[];
  blockedCategories: MemoryCategory[];
  minScore: number;
  minConfidence: number;
  autoSummarize: boolean;
  autoCleanup: boolean;
};

export const DEFAULT_MEMORY_ENGINE_ORG_CONFIG: MemoryEngineOrgConfig = {
  mem0Enabled: false,
  provider: "openconduit",
  maxMemories: 100,
  retentionDays: 365,
  allowedCategories: [...MEMORY_CATEGORIES],
  blockedCategories: [],
  minScore: 0.3,
  minConfidence: 0.5,
  autoSummarize: true,
  autoCleanup: true,
};

export type OrgMemoryStore = {
  config: MemoryEngineOrgConfig;
  globalMemories: MemoryRecord[];
  updatedAt: string;
};

export function newMemoryId(prefix = "mem"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeMemoryRecord(
  raw: Partial<MemoryRecord> & { text: string },
  defaults?: Partial<MemoryRecord>,
): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: raw.id ?? newMemoryId(),
    category: raw.category ?? defaults?.category ?? "preferences",
    text: raw.text.trim(),
    origin: raw.origin ?? defaults?.origin ?? "agent",
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : (defaults?.confidence ?? 0.7),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    lastUsedAt: raw.lastUsedAt ?? null,
    useCount: typeof raw.useCount === "number" ? raw.useCount : 0,
    status: raw.status ?? "active",
    scope: raw.scope ?? defaults?.scope ?? "contact",
    score:
      typeof raw.score === "number" && Number.isFinite(raw.score)
        ? Math.min(1, Math.max(0, raw.score))
        : (defaults?.score ?? 0.6),
    metadata: raw.metadata,
  };
}
