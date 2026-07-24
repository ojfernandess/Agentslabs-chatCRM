import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Brain, Clock, Download, Loader2, Pin, Save, Search, Tag, Trash2, Upload, User } from "lucide-react";
import { api } from "@/lib/api";

export type MemoryCenterData = {
  contact: { id: string; name: string; phone: string; email: string | null };
  conversationId: string | null;
  botId: string | null;
  botName: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  preferences: Record<string, string>;
  aiMemories: Array<{
    id: string;
    text: string;
    source: string;
    createdAt: string;
    category?: string;
    status?: string;
    score?: number;
  }>;
  memoryRecords?: Array<{
    id: string;
    text: string;
    source: string;
    createdAt: string;
    category?: string;
    status?: string;
    score?: number;
  }>;
  pinnedMemories?: Array<{ id: string; text: string; category?: string; status?: string }>;
  automaticMemories?: Array<{ id: string; text: string; category?: string; status?: string }>;
  manualMemories?: Array<{ id: string; text: string; category?: string; status?: string }>;
  archivedMemories?: Array<{ id: string; text: string; category?: string; status?: string }>;
  score: number | null;
  lastInteractionAt: string | null;
  flowSlots: Record<string, string | number | boolean>;
  flowStep: string | null;
  history: Array<{ userMessage: string; assistantMessage: string; at: string; botName?: string | null }>;
  memoryProvider: string;
  contextUpdatedAt: string | null;
};

type ContextRow = {
  conversationId: string;
  botId: string;
  botName: string;
  updatedAt: string;
  lastClearedAt: string | null;
};

type SearchHit = {
  contactId: string;
  contactName: string;
  contactPhone: string;
  conversationId: string | null;
  lastInteractionAt: string | null;
  score: number | null;
  tagNames: string[];
};

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale.startsWith("pt") ? "pt-PT" : "en-US");
  } catch {
    return iso;
  }
}

const MEMORY_CATEGORIES = [
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
] as const;

function categoryLabel(category: string, t: (key: string) => string): string {
  const key = `automationPage.memoryCategory_${category}`;
  const label = t(key);
  return label !== key ? label : category.replace(/_/g, " ");
}

export function MemoryCenterPanel({
  t,
  locale,
  loading: parentLoading,
  contextRows,
  onRefreshRows,
  onClearContext,
}: {
  t: (key: string) => string;
  locale: string;
  loading: boolean;
  contextRows: ContextRow[];
  onRefreshRows: () => Promise<void>;
  onClearContext: (conversationId: string) => Promise<void>;
}) {
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [data, setData] = useState<MemoryCenterData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [prefKey, setPrefKey] = useState("");
  const [prefValue, setPrefValue] = useState("");
  const [aiMemories, setAiMemories] = useState<
    Array<{ id?: string; text: string; category?: string; status?: string }>
  >([]);
  const [newMemory, setNewMemory] = useState("");
  const [newMemoryCategory, setNewMemoryCategory] = useState<string>("preferences");
  const [importing, setImporting] = useState(false);
  const [score, setScore] = useState<number | "">("");

  const loadByConversation = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setLoadingDetail(true);
    setError("");
    try {
      const res = await api.get<{ data: MemoryCenterData }>(`/automation/memory-center/by-conversation/${trimmed}`);
      setData(res.data);
      setConversationId(trimmed);
      setPreferences(res.data.preferences ?? {});
      setAiMemories(
        (res.data.memoryRecords ?? res.data.aiMemories ?? []).map((m) => ({
          id: m.id,
          text: m.text,
          category: m.category,
          status: m.status,
        })),
      );
      setScore(res.data.score ?? "");
    } catch {
      setData(null);
      setError("load_failed");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (contextRows.length > 0 && !conversationId && !data) {
      void loadByConversation(contextRows[0].conversationId);
    }
  }, [contextRows, conversationId, data, loadByConversation]);

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    setError("");
    try {
      const res = await api.get<{ data: SearchHit[] }>(
        `/automation/memory-center/search?q=${encodeURIComponent(q)}`,
      );
      setSearchHits(res.data);
    } catch {
      setSearchHits([]);
      setError("load_failed");
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!data?.conversationId) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.patch<{ data: MemoryCenterData }>(
        `/automation/memory-center/by-conversation/${data.conversationId}`,
        {
          preferences,
          aiMemories: aiMemories.map((m) => ({ text: m.text, source: "manual" as const })),
          score: score === "" ? null : Number(score),
        },
      );
      setData(res.data);
      setPreferences(res.data.preferences ?? {});
      setAiMemories(
        (res.data.memoryRecords ?? res.data.aiMemories ?? []).map((m) => ({
          id: m.id,
          text: m.text,
          category: m.category,
          status: m.status,
        })),
      );
      setScore(res.data.score ?? "");
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const addPreference = () => {
    const k = prefKey.trim();
    if (!k) return;
    setPreferences((prev) => ({ ...prev, [k]: prefValue }));
    setPrefKey("");
    setPrefValue("");
  };

  const patchMemory = async (memoryId: string, patch: { status?: string; category?: string }) => {
    if (!data?.conversationId || !memoryId) return;
    try {
      const res = await api.patch<{ data: MemoryCenterData }>(
        `/automation/memory-center/by-conversation/${data.conversationId}/memory/${memoryId}`,
        patch,
      );
      setData(res.data);
      setAiMemories(
        (res.data.memoryRecords ?? res.data.aiMemories ?? []).map((m) => ({
          id: m.id,
          text: m.text,
          category: m.category,
          status: m.status,
        })),
      );
    } catch {
      setError("save_failed");
    }
  };

  const deleteMemory = async (memoryId: string) => {
    if (!data?.conversationId || !memoryId) return;
    try {
      const res = await api.delete<{ data: MemoryCenterData }>(
        `/automation/memory-center/by-conversation/${data.conversationId}/memory/${memoryId}`,
      );
      setData(res.data);
      setAiMemories(
        (res.data.memoryRecords ?? res.data.aiMemories ?? []).map((m) => ({
          id: m.id,
          text: m.text,
          category: m.category,
          status: m.status,
        })),
      );
    } catch {
      setError("save_failed");
    }
  };

  const exportMemories = async () => {
    if (!data?.conversationId) return;
    try {
      const res = await fetch(
        `/api/automation/memory-center/by-conversation/${data.conversationId}/export`,
        { credentials: "include" },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memory-center-${data.contact.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("save_failed");
    }
  };

  const importMemories = async (file: File) => {
    if (!data?.conversationId) return;
    setImporting(true);
    setError("");
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as {
        memories?: Array<{ text?: string; category?: string; status?: string; source?: string }>;
      };
      const memories = (parsed.memories ?? [])
        .map((m) => ({
          text: String(m.text ?? "").trim(),
          category: MEMORY_CATEGORIES.includes(m.category as (typeof MEMORY_CATEGORIES)[number])
            ? (m.category as (typeof MEMORY_CATEGORIES)[number])
            : undefined,
          status:
            m.status === "pinned" || m.status === "archived" || m.status === "active"
              ? m.status
              : undefined,
          source: "import" as const,
        }))
        .filter((m) => m.text.length >= 20);
      if (memories.length === 0) {
        setError("import_empty");
        return;
      }
      const res = await api.post<{ data: MemoryCenterData }>(
        `/automation/memory-center/by-conversation/${data.conversationId}/import`,
        { memories },
      );
      setData(res.data);
      setAiMemories(
        (res.data.memoryRecords ?? res.data.aiMemories ?? []).map((m) => ({
          id: m.id,
          text: m.text,
          category: m.category,
          status: m.status,
        })),
      );
    } catch {
      setError("import_failed");
    } finally {
      setImporting(false);
    }
  };

  const addMemory = () => {
    const text = newMemory.trim();
    if (!text) return;
    setAiMemories((prev) => [...prev, { text, category: newMemoryCategory }]);
    setNewMemory("");
  };

  const busy = parentLoading || loadingDetail || saving;

  return (
    <div className="max-w-4xl space-y-5 text-sm text-ink-700 dark:text-ink-300">
      <p>{t("automationPage.memoryCenterBlurb")}</p>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            placeholder={t("automationPage.memoryCenterSearchPlaceholder")}
            className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
          />
        </div>
        <button
          type="button"
          disabled={busy || searching}
          onClick={() => void runSearch()}
          className="rounded-lg border border-ink-200 px-4 py-2 font-medium dark:border-ink-600"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : t("automationPage.memoryCenterSearch")}
        </button>
      </div>

      {searchHits.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-200 dark:border-ink-700">
          {searchHits.map((hit) => (
            <li key={hit.contactId}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-ink-50 dark:hover:bg-ink-900/50"
                onClick={() => hit.conversationId && void loadByConversation(hit.conversationId)}
              >
                <span className="font-medium text-ink-900 dark:text-ink-100">
                  {hit.contactName} · {hit.contactPhone}
                </span>
                <span className="text-ink-500">
                  {hit.tagNames.slice(0, 3).join(", ") || "—"} · {formatDate(hit.lastInteractionAt, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          placeholder={t("automationPage.contextConversationPlaceholder")}
          className="min-w-[240px] flex-1 rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadByConversation(conversationId)}
          className="rounded-lg border border-ink-200 px-4 py-2 font-medium dark:border-ink-600"
        >
          {t("automationPage.contextLoad")}
        </button>
        <button
          type="button"
          disabled={busy || !conversationId.trim()}
          onClick={() => void onClearContext(conversationId)}
          className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {t("automationPage.contextClear")}
        </button>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.contextRecent")}</h3>
        {contextRows.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">{t("automationPage.contextEmpty")}</p>
        ) : (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-200 dark:border-ink-700">
            {contextRows.map((r) => (
              <li
                key={r.conversationId}
                className={clsx(
                  "flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2 text-xs dark:border-ink-800",
                  data?.conversationId === r.conversationId && "bg-brand-50/60 dark:bg-brand-950/20",
                )}
              >
                <div className="min-w-0">
                  <code className="break-all text-ink-800 dark:text-ink-200">{r.conversationId}</code>
                  <div className="text-ink-500">
                    {r.botName} · {formatDate(r.updatedAt, locale)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="font-medium text-brand-600"
                    onClick={() => void loadByConversation(r.conversationId)}
                  >
                    {t("automationPage.contextLoad")}
                  </button>
                  <button
                    type="button"
                    className="font-medium text-red-600"
                    onClick={() => void onClearContext(r.conversationId)}
                  >
                    {t("automationPage.contextClear")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error === "import_empty"
            ? t("automationPage.memoryCenterImportEmpty")
            : error === "import_failed"
              ? t("automationPage.memoryCenterImportFailed")
              : t("automationPage.memoryCenterError")}
        </p>
      ) : null}

      {loadingDetail ? (
        <div className="flex items-center gap-2 p-6 text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("automationPage.memoryCenterLoading")}
        </div>
      ) : null}

      {data && !loadingDetail ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-950/50">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-600">
                <User className="h-4 w-4" />
                {t("automationPage.memoryCenterContact")}
              </div>
              <p className="mt-2 font-semibold text-ink-900 dark:text-ink-50">{data.contact.name}</p>
              <p className="text-xs text-ink-500">{data.contact.phone}</p>
              {data.contact.email ? <p className="text-xs text-ink-500">{data.contact.email}</p> : null}
              {data.botName ? (
                <p className="mt-2 text-xs text-ink-600 dark:text-ink-400">
                  {t("automationPage.memoryCenterAgent")}: {data.botName}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-950/50">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-600">
                <Clock className="h-4 w-4" />
                {t("automationPage.memoryCenterMeta")}
              </div>
              <p className="mt-2 text-xs">
                {t("automationPage.memoryCenterLastInteraction")}: {formatDate(data.lastInteractionAt, locale)}
              </p>
              <p className="mt-1 text-xs">
                {t("automationPage.memoryCenterProvider")}: {data.memoryProvider}
              </p>
              {data.flowStep ? (
                <p className="mt-1 text-xs">
                  {t("automationPage.memoryCenterFlowStep")}: {data.flowStep}
                </p>
              ) : null}
              <label className="mt-3 block text-xs font-medium">
                {t("automationPage.memoryCenterScore")}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(e) => setScore(e.target.value === "" ? "" : Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
                />
              </label>
            </div>
          </div>

          {data.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {data.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: tag.color || "#64748b" }}
                >
                  <Tag className="h-3 w-3" />
                  {tag.name}
                </span>
              ))}
            </div>
          ) : null}

          <div className="rounded-xl border border-ink-200 bg-white/90 dark:border-ink-700 dark:bg-ink-950/50">
            <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 dark:border-ink-800">
              <Brain className="h-4 w-4 text-ink-600" />
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">
                {t("automationPage.memoryCenterPreferences")}
              </h4>
            </div>
            <div className="space-y-2 px-3 py-3">
              {Object.entries(preferences).map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-center gap-2 text-xs">
                  <code className="rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-800">{k}</code>
                  <span className="flex-1 text-ink-700 dark:text-ink-300">{v}</span>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() =>
                      setPreferences((prev) => {
                        const next = { ...prev };
                        delete next[k];
                        return next;
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <input
                  value={prefKey}
                  onChange={(e) => setPrefKey(e.target.value)}
                  placeholder={t("automationPage.memoryCenterPrefKey")}
                  className="min-w-[120px] flex-1 rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                />
                <input
                  value={prefValue}
                  onChange={(e) => setPrefValue(e.target.value)}
                  placeholder={t("automationPage.memoryCenterPrefValue")}
                  className="min-w-[160px] flex-[2] rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                />
                <button
                  type="button"
                  onClick={addPreference}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium dark:border-ink-600"
                >
                  {t("automationPage.memoryCenterAdd")}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white/90 dark:border-ink-700 dark:bg-ink-950/50">
            <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-ink-600" />
                <h4 className="text-xs font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">
                  {t("automationPage.memoryCenterAiMemories")}
                </h4>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void exportMemories()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("automationPage.memoryCenterExport")}
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-brand-600">
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {t("automationPage.memoryCenterImport")}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={importing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importMemories(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="space-y-2 px-3 py-3">
              {aiMemories.length === 0 ? (
                <p className="text-xs text-ink-500">{t("automationPage.memoryCenterAiMemoriesEmpty")}</p>
              ) : (
                aiMemories.map((m, idx) => (
                  <div key={m.id ?? idx} className="flex gap-2 rounded-lg bg-ink-50 px-2 py-1.5 text-xs dark:bg-ink-900/40">
                    <div className="flex-1 space-y-1">
                      <select
                        className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] dark:border-ink-700 dark:bg-ink-950"
                        value={m.category ?? "preferences"}
                        disabled={!m.id}
                        onChange={(e) => {
                          if (m.id) void patchMemory(m.id, { category: e.target.value });
                        }}
                      >
                        {MEMORY_CATEGORIES.filter((c) => c !== "temporary").map((cat) => (
                          <option key={cat} value={cat}>
                            {categoryLabel(cat, t)}
                          </option>
                        ))}
                      </select>
                      <p className="whitespace-pre-wrap text-ink-800 dark:text-ink-200">{m.text}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {m.id ? (
                        <>
                          <button
                            type="button"
                            className="text-amber-600"
                            title={t("automationPage.memoryCenterPin")}
                            onClick={() =>
                              void patchMemory(m.id!, {
                                status: m.status === "pinned" ? "active" : "pinned",
                              })
                            }
                          >
                            <Pin className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="text-ink-500"
                            title={t("automationPage.memoryCenterArchive")}
                            onClick={() => void patchMemory(m.id!, { status: "archived" })}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            className="text-red-600"
                            onClick={() => void deleteMemory(m.id!)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="text-red-600"
                          onClick={() => setAiMemories((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <select
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value)}
                  className="rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                >
                  {MEMORY_CATEGORIES.filter((c) => c !== "temporary").map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabel(cat, t)}
                    </option>
                  ))}
                </select>
                <input
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder={t("automationPage.memoryCenterNewMemory")}
                  className="min-w-[200px] flex-1 rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                />
                <button
                  type="button"
                  onClick={addMemory}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium dark:border-ink-600"
                >
                  {t("automationPage.memoryCenterAdd")}
                </button>
              </div>
            </div>
          </div>

          {Object.keys(data.flowSlots).length > 0 ? (
            <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-950/50">
              <p className="text-xs font-semibold text-ink-500">{t("automationPage.memoryCenterFlowSlots")}</p>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-800 dark:text-ink-200">
                {JSON.stringify(data.flowSlots, null, 2)}
              </pre>
            </div>
          ) : null}

          {data.history.length > 0 ? (
            <div className="rounded-xl border border-ink-200 dark:border-ink-700">
              <h4 className="border-b border-ink-100 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-700 dark:border-ink-800 dark:text-ink-200">
                {t("automationPage.memoryCenterHistory")}
              </h4>
              <ul className="max-h-64 divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
                {data.history.map((turn, idx) => (
                  <li key={idx} className="px-3 py-2 text-xs">
                    <div className="text-ink-500">
                      {turn.botName ?? data.botName ?? "—"} · {formatDate(turn.at, locale)}
                    </div>
                    <p className="mt-1 font-medium text-ink-900 dark:text-ink-100">{turn.userMessage.slice(0, 280)}</p>
                    <p className="mt-1 text-ink-600 dark:text-ink-400">{turn.assistantMessage.slice(0, 320)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !data.conversationId}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("automationPage.memoryCenterSave")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRefreshRows()}
              className="rounded-lg border border-ink-200 px-4 py-2 font-medium dark:border-ink-600"
            >
              {t("automationPage.refresh")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
