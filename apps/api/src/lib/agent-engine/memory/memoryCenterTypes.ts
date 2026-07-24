export type AiMemoryEntry = {
  id: string;
  text: string;
  source: "agent" | "manual" | "system";
  createdAt: string;
  category?: string;
  confidence?: number;
  status?: "active" | "pinned" | "archived";
  score?: number;
  origin?: string;
  scope?: string;
  lastUsedAt?: string | null;
  useCount?: number;
};

export type MemoryCenterPreferences = Record<string, string>;

export type MemoryCenterHistoryTurn = {
  userMessage: string;
  assistantMessage: string;
  at: string;
  botName?: string | null;
};

export type MemoryCenterView = {
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };
  conversationId: string | null;
  botId: string | null;
  botName: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  preferences: MemoryCenterPreferences;
  aiMemories: AiMemoryEntry[];
  memoryRecords: AiMemoryEntry[];
  pinnedMemories: AiMemoryEntry[];
  automaticMemories: AiMemoryEntry[];
  manualMemories: AiMemoryEntry[];
  archivedMemories: AiMemoryEntry[];
  score: number | null;
  lastInteractionAt: string | null;
  flowSlots: Record<string, string | number | boolean>;
  flowStep: string | null;
  history: MemoryCenterHistoryTurn[];
  memoryProvider: "openconduit" | "mem0";
  contextUpdatedAt: string | null;
};

export type MemoryCenterSearchHit = {
  contactId: string;
  contactName: string;
  contactPhone: string;
  conversationId: string | null;
  lastInteractionAt: string | null;
  score: number | null;
  tagNames: string[];
};

export type MemoryCenterStateSlice = {
  preferences?: MemoryCenterPreferences;
  aiMemories?: AiMemoryEntry[];
  score?: number | null;
  lastInteractionAt?: string | null;
};

export function parseMemoryCenterFromState(state: unknown): MemoryCenterStateSlice {
  if (!state || typeof state !== "object") return {};
  const root = state as Record<string, unknown>;
  const mc = root.memoryCenter;
  if (!mc || typeof mc !== "object") return {};
  const o = mc as Record<string, unknown>;
  const preferences: MemoryCenterPreferences | undefined =
    o.preferences && typeof o.preferences === "object" && !Array.isArray(o.preferences)
      ? (Object.fromEntries(
          Object.entries(o.preferences as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string",
          ),
        ) as MemoryCenterPreferences)
      : undefined;
  const aiMemories = Array.isArray(o.aiMemories)
    ? o.aiMemories
        .map((item, idx) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const text = typeof row.text === "string" ? row.text.trim() : "";
          if (!text) return null;
          return {
            id: typeof row.id === "string" ? row.id : `mem_${idx}`,
            text,
            source:
              row.source === "manual" || row.source === "system" || row.source === "agent"
                ? row.source
                : ("agent" as const),
            createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
          };
        })
        .filter((x): x is AiMemoryEntry => x != null)
    : undefined;
  const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null;
  const lastInteractionAt =
    typeof o.lastInteractionAt === "string" ? o.lastInteractionAt : undefined;
  return { preferences, aiMemories, score, lastInteractionAt };
}

export function mergeMemoryCenterIntoState(
  state: Record<string, unknown>,
  patch: MemoryCenterStateSlice,
): Record<string, unknown> {
  const prev = parseMemoryCenterFromState(state);
  const next: MemoryCenterStateSlice = {
    preferences: patch.preferences ?? prev.preferences ?? {},
    aiMemories: patch.aiMemories ?? prev.aiMemories ?? [],
    score: patch.score !== undefined ? patch.score : (prev.score ?? null),
    lastInteractionAt: patch.lastInteractionAt ?? prev.lastInteractionAt ?? null,
  };
  return {
    ...state,
    memoryCenter: next,
  };
}

/** Filtra memórias irrelevantes (saudações, casual, temporário). */
export function filterRelevantAiMemoryText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length < 8) return false;
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|tchau|obrigad)/.test(t)) return false;
  if (/(temporário|temporario|por agora|só hoje|so hoje)/.test(t)) return false;
  return true;
}

/** Extrai memória candidata a partir de turno (para Mem0 / agent engine). */
export function suggestAiMemoryFromTurn(userMessage: string, assistantMessage: string): string | null {
  const user = userMessage.trim();
  const assistant = assistantMessage.trim();
  const combined = `${user}\n${assistant}`.trim();
  if (!filterRelevantAiMemoryText(combined)) return null;
  const locator = user.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{4,12}\b/i)?.[0];
  if (locator && /localizador|reserva|código|codigo/i.test(combined)) {
    return `Localizador/reserva informado: ${locator.toUpperCase()}`;
  }
  if (user.length >= 20 && user.length <= 400) {
    return user.slice(0, 400);
  }
  return null;
}
