import type {
  MemoryCategory,
  MemoryEngineConfig,
  MemoryEngineOrgConfig,
  MemoryRecord,
} from "./memoryEngineTypes.js";

const CASUAL_PATTERNS = [
  /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|tchau|obrigad|thanks|thank you|ok|okay|tudo bem|sim|não|nao)\b/i,
  /^(certo|entendi|perfeito|show|blz|beleza)\.?$/i,
];

const TEMPORARY_PATTERNS = [
  /temporár/i,
  /temporario/i,
  /por agora/i,
  /só hoje/i,
  /so hoje/i,
  /neste momento/i,
  /agora mesmo/i,
];

export function isCasualText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.length < 20) return true;
  return CASUAL_PATTERNS.some((re) => re.test(t));
}

export function isTemporaryText(text: string): boolean {
  return TEMPORARY_PATTERNS.some((re) => re.test(text));
}

export function normalizeMemoryText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function memoryTextsSimilar(a: string, b: string): boolean {
  const na = normalizeMemoryText(a);
  const nb = normalizeMemoryText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = new Set(na.split(" ").filter((w) => w.length > 3));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap += 1;
  }
  const ratio = overlap / Math.min(wordsA.size, wordsB.size);
  return ratio >= 0.75;
}

export function isCategoryAllowed(
  category: MemoryCategory,
  orgConfig: MemoryEngineOrgConfig,
): boolean {
  if (orgConfig.blockedCategories.includes(category)) return false;
  if (orgConfig.allowedCategories.length === 0) return true;
  return orgConfig.allowedCategories.includes(category);
}

export function validateMemoryCandidate(input: {
  text: string;
  category: MemoryCategory;
  confidence: number;
  config: MemoryEngineConfig;
  orgConfig: MemoryEngineOrgConfig;
}): { ok: boolean; reason?: string } {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length < 20) return { ok: false, reason: "too_short" };
  if (input.config.ignoreCasualConversations && isCasualText(text)) {
    return { ok: false, reason: "casual" };
  }
  if (isTemporaryText(text)) return { ok: false, reason: "temporary" };
  if (input.category === "temporary") return { ok: false, reason: "temporary_category" };

  if (input.category === "preferences" && !input.config.rememberPreferences) {
    return { ok: false, reason: "category_disabled" };
  }
  if (input.category === "commercial_history" && !input.config.rememberCommercialHistory) {
    return { ok: false, reason: "category_disabled" };
  }
  if (input.category === "technical_data" && !input.config.rememberTechnicalData) {
    return { ok: false, reason: "category_disabled" };
  }

  if (!isCategoryAllowed(input.category, input.orgConfig)) {
    return { ok: false, reason: "category_blocked" };
  }
  if (input.confidence < input.orgConfig.minConfidence) {
    return { ok: false, reason: "low_confidence" };
  }
  return { ok: true };
}

export function findDuplicateMemory(
  candidates: MemoryRecord[],
  text: string,
  category?: MemoryCategory,
): MemoryRecord | null {
  for (const row of candidates) {
    if (row.status === "archived") continue;
    if (category && row.category !== category) continue;
    if (memoryTextsSimilar(row.text, text)) return row;
  }
  return null;
}

export function applyDuplicateUpdate(existing: MemoryRecord, incoming: Partial<MemoryRecord>): MemoryRecord {
  const now = new Date().toISOString();
  return {
    ...existing,
    confidence: Math.max(existing.confidence, incoming.confidence ?? existing.confidence),
    score: Math.min(1, existing.score + 0.05),
    useCount: existing.useCount + 1,
    lastUsedAt: now,
    updatedAt: now,
    category: incoming.category ?? existing.category,
  };
}

export function trimMemoriesToLimit(records: MemoryRecord[], max: number): MemoryRecord[] {
  if (records.length <= max) return records;
  const ranked = [...records].sort((a, b) => {
    if (a.status === "pinned" && b.status !== "pinned") return -1;
    if (b.status === "pinned" && a.status !== "pinned") return 1;
    return b.score - a.score || b.useCount - a.useCount;
  });
  return ranked.slice(0, max);
}

export function applyRetention(records: MemoryRecord[], retentionDays: number): MemoryRecord[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return records.filter((row) => {
    if (row.status === "pinned") return true;
    const ts = Date.parse(row.updatedAt || row.createdAt);
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}
