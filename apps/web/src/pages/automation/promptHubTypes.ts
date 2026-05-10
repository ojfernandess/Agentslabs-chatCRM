export type PromptModuleRow = {
  id: string;
  name: string;
  slug: string;
  body: string;
  version: number;
  labels?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export type PromptStatus = "production" | "test" | "draft" | "active";

export type PromptHistoryEntry = {
  at: string;
  version: number;
  body: string;
};

/** Defaults for agent / preview LLM (no apiKey — never store secrets in labels). */
export type PromptLlmDefaults = {
  provider: "openai" | "google_gemini";
  model: string;
  temperature: number;
  maxTokens: number;
  apiBaseUrl: string | null;
};

export type PromptLabels = {
  category?: string;
  tags?: string[];
  status?: PromptStatus;
  modelHint?: string;
  description?: string;
  icon?: string;
  color?: string;
  connectedToolIds?: string[];
  /** Persisted from preview tab — applied when creating an agent from this module */
  llmDefaults?: PromptLlmDefaults;
  history?: PromptHistoryEntry[];
  analytics?: {
    executions?: number;
    successRate?: number;
    tokens?: number;
    avgMs?: number;
    rating?: number;
  };
  /** Display name persisted on create / first save */
  createdByName?: string;
};

export function parseLlmDefaultsFromUnknown(raw: unknown): PromptLlmDefaults | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const prov = d.provider === "google_gemini" ? "google_gemini" : d.provider === "openai" ? "openai" : null;
  if (!prov) return undefined;
  const model = typeof d.model === "string" && d.model.trim() ? d.model.trim() : "gpt-4o-mini";
  const temperature =
    typeof d.temperature === "number" && !Number.isNaN(d.temperature)
      ? Math.min(2, Math.max(0, d.temperature))
      : 0.7;
  const maxTokens =
    typeof d.maxTokens === "number" && Number.isFinite(d.maxTokens)
      ? Math.min(8192, Math.max(16, Math.floor(d.maxTokens)))
      : 1024;
  const apiBaseUrl =
    d.apiBaseUrl === null || d.apiBaseUrl === undefined
      ? null
      : typeof d.apiBaseUrl === "string"
        ? d.apiBaseUrl.trim() || null
        : null;
  return { provider: prov, model, temperature, maxTokens, apiBaseUrl };
}

export function parsePromptLabels(raw: unknown): PromptLabels {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tags = Array.isArray(o.tags) ? o.tags.filter((x): x is string => typeof x === "string") : [];
  let status: PromptStatus = "active";
  if (o.status === "production" || o.status === "test" || o.status === "draft" || o.status === "active") {
    status = o.status;
  }
  const category = typeof o.category === "string" && o.category ? o.category : "general";
  const llmDefaults = parseLlmDefaultsFromUnknown(o.llmDefaults);
  return {
    category,
    tags,
    status,
    modelHint: typeof o.modelHint === "string" ? o.modelHint : "",
    description: typeof o.description === "string" ? o.description : "",
    icon: typeof o.icon === "string" ? o.icon : "Sparkles",
    color: typeof o.color === "string" ? o.color : "violet",
    connectedToolIds: Array.isArray(o.connectedToolIds)
      ? o.connectedToolIds.filter((x): x is string => typeof x === "string")
      : [],
    ...(llmDefaults ? { llmDefaults } : {}),
    history: Array.isArray(o.history)
      ? (o.history.filter(
          (h): h is PromptHistoryEntry =>
            h &&
            typeof h === "object" &&
            typeof (h as PromptHistoryEntry).at === "string" &&
            typeof (h as PromptHistoryEntry).body === "string" &&
            typeof (h as PromptHistoryEntry).version === "number",
        ) as PromptHistoryEntry[])
      : [],
    analytics:
      o.analytics && typeof o.analytics === "object"
        ? (o.analytics as PromptLabels["analytics"])
        : undefined,
    createdByName: typeof o.createdByName === "string" ? o.createdByName : undefined,
  };
}
