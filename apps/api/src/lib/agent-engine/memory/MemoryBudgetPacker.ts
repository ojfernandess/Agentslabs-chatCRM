import type { MemoryRecord, MemoryScope } from "./memoryEngineTypes.js";
import { estimateMemoryTokens } from "./MemoryContextBuilder.js";

/** Prioridade explícita (maior = mais importante). pinned → 100. */
export type MemoryPriority = 0 | 25 | 50 | 75 | 100;

export type MemoryBudgetConfig = {
  /** Orçamento de tokens do appendix de memória no prompt. */
  promptTokenBudget: number;
  /** TTL default em segundos (0 = sem TTL). */
  defaultTtlSeconds: number;
  /** Máx. itens por scope após packing (além do budget). */
  maxPerScope: number;
};

export const DEFAULT_MEMORY_BUDGET_CONFIG: MemoryBudgetConfig = {
  promptTokenBudget: 1200,
  defaultTtlSeconds: 0,
  maxPerScope: 15,
};

export type MemoryPackResult = {
  hierarchy: {
    temporary: MemoryRecord[];
    contact: MemoryRecord[];
    agent: MemoryRecord[];
    global: MemoryRecord[];
  };
  records: MemoryRecord[];
  tokensUsed: number;
  tokensBudget: number;
  truncated: boolean;
  droppedIds: string[];
  expiredIds: string[];
};

const SCOPE_ORDER: MemoryScope[] = ["temporary", "contact", "agent", "global"];

export function resolveMemoryPriority(row: MemoryRecord): number {
  if (row.status === "pinned") return 100;
  const meta = row.metadata;
  if (meta && typeof meta.priority === "number" && Number.isFinite(meta.priority)) {
    return Math.min(100, Math.max(0, Math.round(meta.priority)));
  }
  // score 0..1 → 0..75
  return Math.round(Math.min(1, Math.max(0, row.score)) * 75);
}

export function isMemoryExpired(
  row: MemoryRecord,
  nowMs: number,
  defaultTtlSeconds: number,
): boolean {
  const meta = row.metadata;
  if (meta && typeof meta.ttlExpiresAt === "string") {
    const exp = Date.parse(meta.ttlExpiresAt);
    if (Number.isFinite(exp)) return nowMs >= exp;
  }
  if (meta && typeof meta.ttlSeconds === "number" && meta.ttlSeconds > 0) {
    const base = Date.parse(row.updatedAt || row.createdAt);
    if (Number.isFinite(base)) return nowMs >= base + meta.ttlSeconds * 1000;
  }
  if (defaultTtlSeconds > 0 && row.scope === "temporary") {
    const base = Date.parse(row.updatedAt || row.createdAt);
    if (Number.isFinite(base)) return nowMs >= base + defaultTtlSeconds * 1000;
  }
  return false;
}

function estimateRecordTokens(row: MemoryRecord): number {
  return Math.max(1, Math.ceil(row.text.length / 4) + 8);
}

/**
 * Packer unificado: filtra TTL → ordena por prioridade → corta ao token budget.
 * Segment-agnostic — sem IFs de hotel/clínica.
 */
export function packMemoryForPrompt(
  hierarchy: {
    temporary: MemoryRecord[];
    contact: MemoryRecord[];
    agent: MemoryRecord[];
    global: MemoryRecord[];
  },
  config: Partial<MemoryBudgetConfig> = {},
  nowMs = Date.now(),
): MemoryPackResult {
  const cfg: MemoryBudgetConfig = {
    ...DEFAULT_MEMORY_BUDGET_CONFIG,
    ...config,
    promptTokenBudget:
      typeof config.promptTokenBudget === "number" && config.promptTokenBudget > 0
        ? Math.min(8000, Math.max(64, Math.round(config.promptTokenBudget)))
        : DEFAULT_MEMORY_BUDGET_CONFIG.promptTokenBudget,
  };

  const expiredIds: string[] = [];
  const filterScope = (rows: MemoryRecord[]): MemoryRecord[] => {
    const kept: MemoryRecord[] = [];
    for (const row of rows) {
      if (isMemoryExpired(row, nowMs, cfg.defaultTtlSeconds)) {
        expiredIds.push(row.id);
        continue;
      }
      kept.push(row);
    }
    return kept.sort((a, b) => resolveMemoryPriority(b) - resolveMemoryPriority(a));
  };

  const filtered = {
    temporary: filterScope(hierarchy.temporary),
    contact: filterScope(hierarchy.contact),
    agent: filterScope(hierarchy.agent),
    global: filterScope(hierarchy.global),
  };

  const candidates: MemoryRecord[] = [];
  for (const scope of SCOPE_ORDER) {
    candidates.push(...filtered[scope].slice(0, cfg.maxPerScope));
  }
  candidates.sort((a, b) => resolveMemoryPriority(b) - resolveMemoryPriority(a));

  const selected: MemoryRecord[] = [];
  const droppedIds: string[] = [];
  let tokensUsed = 0;
  const headerTokens = 40;

  for (const row of candidates) {
    const cost = estimateRecordTokens(row);
    if (tokensUsed + cost + headerTokens > cfg.promptTokenBudget) {
      droppedIds.push(row.id);
      continue;
    }
    selected.push(row);
    tokensUsed += cost;
  }

  const selectedIds = new Set(selected.map((r) => r.id));
  const packedHierarchy = {
    temporary: filtered.temporary.filter((r) => selectedIds.has(r.id)),
    contact: filtered.contact.filter((r) => selectedIds.has(r.id)),
    agent: filtered.agent.filter((r) => selectedIds.has(r.id)),
    global: filtered.global.filter((r) => selectedIds.has(r.id)),
  };

  return {
    hierarchy: packedHierarchy,
    records: selected,
    tokensUsed: tokensUsed + (selected.length > 0 ? headerTokens : 0),
    tokensBudget: cfg.promptTokenBudget,
    truncated: droppedIds.length > 0 || expiredIds.length > 0,
    droppedIds,
    expiredIds,
  };
}

export function estimatePackedTokens(records: MemoryRecord[]): number {
  return estimateMemoryTokens(records) + (records.length > 0 ? 40 : 0);
}
