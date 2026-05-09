import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  BookOpen,
  Brain,
  ChevronRight,
  Cloud,
  FileText,
  History,
  LayoutDashboard,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  Upload,
  Wand2,
} from "lucide-react";
import { ApiError, api } from "@/lib/api";

export type KnowledgeArticleRow = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  isActive: boolean;
  syncToAi: boolean;
  botIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
};

type BotRow = { id: string; name: string };

type KbSub =
  | "dashboard"
  | "documents"
  | "categories"
  | "sources"
  | "rag"
  | "history"
  | "analytics"
  | "playground";

type HubMetrics = {
  totalDocuments: number;
  activeDocuments: number;
  syncEnabled: number;
  estimatedTokens: number;
  estimatedChunks: number;
  indexedChunks: number;
  embeddingModel: string | null;
  semanticSearchReady: boolean;
  lastUpdatedAt: string | null;
  searchesWeek: number;
  searchSuccessRate: number | null;
  topQueries: Array<{ query: string; count: number; avgResults: number }>;
  categories: string[];
  documentsPreview: Array<{
    id: string;
    title: string;
    category: string | null;
    tags: string[];
    isActive: boolean;
    syncToAi: boolean;
    updatedAt: string;
    sourceFileName?: string | null;
    estimatedChunks: number;
    estimatedTokens: number;
  }>;
};

function naiveMdToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n\n+/)
    .map((p) => {
      const line = p
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code class='rounded bg-ink-100 px-1 text-xs dark:bg-ink-800'>$1</code>")
        .replace(/\n/g, "<br/>");
      return `<p class="mb-3 leading-relaxed last:mb-0">${line}</p>`;
    })
    .join("");
}

const SOURCE_PRESETS = [
  { key: "gdrive", icon: Cloud },
  { key: "notion", icon: FileText },
  { key: "web", icon: Link2 },
  { key: "confluence", icon: BookOpen },
  { key: "zendesk", icon: Tags },
  { key: "github", icon: Link2 },
] as const;

export function AutomationKnowledgeHub({
  t,
  loading,
  setLoading,
  setError,
  bots,
  articles,
  onRefresh,
}: {
  t: (path: string) => string;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (code: string) => void;
  bots: BotRow[];
  articles: KnowledgeArticleRow[];
  onRefresh: () => Promise<void>;
}) {
  const [sub, setSub] = useState<KbSub>("dashboard");
  const [metrics, setMetrics] = useState<HubMetrics | null>(null);
  const [docFilter, setDocFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPreview, setEditorPreview] = useState(false);
  const [kbForm, setKbForm] = useState({
    id: null as string | null,
    title: "",
    content: "",
    category: "",
    tags: "",
    isActive: true,
    syncToAi: true,
    botIds: [] as string[],
    sourceFileName: null as string | null,
  });

  const [searchQ, setSearchQ] = useState("");
  const [searchBotId, setSearchBotId] = useState("");
  const [searchRanking, setSearchRanking] = useState<Array<{ id: string; score: number; excerpt: string }> | null>(
    null,
  );
  const [searchResults, setSearchResults] = useState<KnowledgeArticleRow[] | null>(null);
  const [searchMode, setSearchMode] = useState<string | null>(null);
  const [reindexBusy, setReindexBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [historyArticleId, setHistoryArticleId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<
    Array<{ id: string; createdAt: string; editor: { name: string | null }; snapshot: unknown }>
  >([]);

  const [ragChunk, setRagChunk] = useState(() => localStorage.getItem("oc_kb_rag_chunk") ?? "1500");
  const [ragOverlap, setRagOverlap] = useState(() => localStorage.getItem("oc_kb_rag_overlap") ?? "200");
  const [ragThreshold, setRagThreshold] = useState(() => localStorage.getItem("oc_kb_rag_threshold") ?? "0.72");

  const [pgQuery, setPgQuery] = useState("");
  const [pgBotId, setPgBotId] = useState("");
  const [pgProvider, setPgProvider] = useState<"openai" | "google_gemini">("openai");
  const [pgModel, setPgModel] = useState("gpt-4o-mini");
  const [pgApiKey, setPgApiKey] = useState("");
  const [pgBaseUrl, setPgBaseUrl] = useState("https://api.openai.com/v1");
  const [pgBusy, setPgBusy] = useState(false);
  const [pgAnswer, setPgAnswer] = useState("");
  const [pgSources, setPgSources] = useState<Array<{ id: string; title: string; score: number; excerpt: string }>>(
    [],
  );
  const [pgMeta, setPgMeta] = useState("");

  const loadMetrics = useCallback(async () => {
    try {
      const m = await api.get<HubMetrics>("/automation/knowledge-articles/hub-metrics");
      setMetrics(m);
    } catch {
      setMetrics(null);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics, articles.length]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const a of articles) {
      if (a.category?.trim()) s.add(a.category.trim());
    }
    return [...s].sort();
  }, [articles]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      for (const tg of a.tags ?? []) {
        const k = tg.trim();
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [articles]);

  const filteredDocs = useMemo(() => {
    const q = docFilter.trim().toLowerCase();
    return articles.filter((a) => {
      if (categoryFilter !== "all" && (a.category ?? "").trim() !== categoryFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q) ||
        (a.tags ?? []).some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [articles, docFilter, categoryFilter]);

  const openNewDoc = () => {
    setKbForm({
      id: null,
      title: "",
      content: "",
      category: "",
      tags: "",
      isActive: true,
      syncToAi: true,
      botIds: [],
      sourceFileName: null,
    });
    setEditorPreview(false);
    setEditorOpen(true);
  };

  const openEditDoc = (a: KnowledgeArticleRow) => {
    setKbForm({
      id: a.id,
      title: a.title,
      content: a.content,
      category: a.category ?? "",
      tags: (a.tags ?? []).join(", "),
      isActive: a.isActive,
      syncToAi: a.syncToAi,
      botIds: a.botIds ?? [],
      sourceFileName: a.sourceFileName ?? null,
    });
    setEditorPreview(false);
    setEditorOpen(true);
  };

  const saveKb = async () => {
    setLoading(true);
    setError("");
    try {
      const tags = kbForm.tags
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (kbForm.id) {
        await api.patch(`/automation/knowledge-articles/${kbForm.id}`, {
          title: kbForm.title,
          content: kbForm.content,
          category: kbForm.category || null,
          tags,
          isActive: kbForm.isActive,
          syncToAi: kbForm.syncToAi,
          botIds: kbForm.botIds,
        });
      } else {
        await api.post("/automation/knowledge-articles", {
          title: kbForm.title,
          content: kbForm.content,
          category: kbForm.category || null,
          tags,
          isActive: kbForm.isActive,
          syncToAi: kbForm.syncToAi,
          botIds: kbForm.botIds,
        });
      }
      setEditorOpen(false);
      await onRefresh();
      await loadMetrics();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteKb = async (id: string) => {
    if (!window.confirm(t("automationPage.kbHub.deleteConfirm"))) return;
    setLoading(true);
    try {
      await api.delete(`/automation/knowledge-articles/${id}`);
      await onRefresh();
      await loadMetrics();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const runSmartSearch = async () => {
    if (!searchQ.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post<{
        data: KnowledgeArticleRow[];
        ranking: Array<{ id: string; score: number; excerpt: string }>;
        searchMode?: "lexical" | "semantic" | "hybrid" | "cached";
      }>("/automation/knowledge-articles/search", {
        query: searchQ.trim(),
        botId: searchBotId || undefined,
      });
      setSearchResults(res.data);
      setSearchRanking(res.ranking ?? null);
      setSearchMode(res.searchMode ?? null);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const runReindexOrganization = async () => {
    if (!window.confirm(t("automationPage.kbHub.reindexOrgConfirm"))) return;
    setReindexBusy(true);
    setError("");
    try {
      await api.post<{ articles: number; errors: number }>("/automation/knowledge-articles/reindex-organization");
      await loadMetrics();
      await onRefresh();
    } catch {
      setError("load_failed");
    } finally {
      setReindexBusy(false);
    }
  };

  const runReindexArticle = async (id: string) => {
    setLoading(true);
    setError("");
    try {
      await api.post(`/automation/knowledge-articles/${id}/reindex`);
      await loadMetrics();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const onImportKnowledgeFile = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postMultipart<
        KnowledgeArticleRow & { extractedChars?: number; botIds?: string[] }
      >("/automation/knowledge-articles/import-file", form);
      await onRefresh();
      await loadMetrics();
      openEditDoc({
        id: res.id,
        title: res.title,
        content: res.content,
        category: res.category,
        tags: res.tags,
        isActive: res.isActive,
        syncToAi: res.syncToAi,
        botIds: res.botIds ?? [],
        sourceFileName: res.sourceFileName ?? null,
        sourceMimeType: res.sourceMimeType ?? null,
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadRevisions = async (articleId: string) => {
    setHistoryArticleId(articleId);
    try {
      const res = await api.get<{
        data: Array<{ id: string; createdAt: string; editor: { name: string | null }; snapshot: unknown }>;
      }>(`/automation/knowledge-articles/${articleId}/revisions`);
      setRevisions(res.data);
    } catch {
      setRevisions([]);
    }
  };

  const persistRagPrefs = () => {
    localStorage.setItem("oc_kb_rag_chunk", ragChunk);
    localStorage.setItem("oc_kb_rag_overlap", ragOverlap);
    localStorage.setItem("oc_kb_rag_threshold", ragThreshold);
  };

  const runPlayground = async () => {
    if (!pgQuery.trim()) return;
    setPgBusy(true);
    setPgAnswer("");
    setPgSources([]);
    setPgMeta("");
    try {
      const res = await api.post<{
        answer: string;
        sources: Array<{ id: string; title: string; score: number; excerpt: string }>;
        latencyMs: number;
        contextChars: number;
        retrievalMode?: "lexical" | "semantic" | "hybrid";
      }>("/automation/knowledge-articles/playground", {
        query: pgQuery.trim(),
        botId: pgBotId || null,
        provider: pgProvider,
        model: pgModel.trim(),
        apiKey: pgApiKey.trim() || null,
        apiBaseUrl: pgProvider === "openai" ? pgBaseUrl.trim() || null : null,
      });
      setPgAnswer(res.answer);
      setPgSources(res.sources);
      const modeLabel =
        res.retrievalMode === "semantic"
          ? t("automationPage.kbHub.searchModeSemantic")
          : res.retrievalMode === "hybrid"
            ? t("automationPage.kbHub.searchModeHybrid")
            : t("automationPage.kbHub.searchModeLexical");
      setPgMeta(`${modeLabel} · ${res.contextChars} ctx · ${res.latencyMs} ms`);
    } catch (e) {
      setPgAnswer(e instanceof ApiError ? e.message : t("automationPage.kbHub.playgroundError"));
    } finally {
      setPgBusy(false);
    }
  };

  const subNav: Array<{ id: KbSub; label: string; icon: typeof LayoutDashboard }> = [
    { id: "dashboard", label: t("automationPage.kbHub.navDashboard"), icon: LayoutDashboard },
    { id: "documents", label: t("automationPage.kbHub.navDocuments"), icon: FileText },
    { id: "categories", label: t("automationPage.kbHub.navCategories"), icon: Tags },
    { id: "sources", label: t("automationPage.kbHub.navSources"), icon: Cloud },
    { id: "rag", label: t("automationPage.kbHub.navRag"), icon: Brain },
    { id: "playground", label: t("automationPage.kbHub.navPlayground"), icon: Wand2 },
    { id: "history", label: t("automationPage.kbHub.navHistory"), icon: History },
    { id: "analytics", label: t("automationPage.kbHub.navAnalytics"), icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-ink-200/80 bg-gradient-to-br from-emerald-500/10 via-white to-sky-500/5 p-6 shadow-sm dark:border-ink-700 dark:from-emerald-500/10 dark:via-ink-900 dark:to-sky-950/20">
        <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/25 dark:bg-ink-800/80 dark:text-emerald-300">
              <Brain className="h-3.5 w-3.5" />
              {t("automationPage.kbHub.badge")}
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
              {t("automationPage.kbHub.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {t("automationPage.kbHub.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadMetrics().then(() => onRefresh())}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white/90 px-4 py-2.5 text-sm font-semibold shadow-sm backdrop-blur dark:border-ink-600 dark:bg-ink-900/80"
            >
              <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
              {t("automationPage.kbHub.sync")}
            </button>
            <button
              type="button"
              onClick={() => void runReindexOrganization()}
              disabled={loading || reindexBusy}
              title={t("automationPage.kbHub.reindexOrgHint")}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-2.5 text-sm font-semibold text-emerald-900 shadow-sm backdrop-blur dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
            >
              <Sparkles className={clsx("h-4 w-4", reindexBusy && "animate-pulse")} />
              {t("automationPage.kbHub.reindexOrg")}
            </button>
            <input
              ref={importFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onImportKnowledgeFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              disabled={loading}
              title={t("automationPage.kbHub.importFileHint")}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white/90 px-4 py-2.5 text-sm font-semibold shadow-sm backdrop-blur dark:border-ink-600 dark:bg-ink-900/80"
            >
              <Upload className="h-4 w-4" />
              {t("automationPage.kbHub.importFile")}
            </button>
            <button
              type="button"
              onClick={openNewDoc}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              {t("automationPage.kbHub.newDoc")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-ink-200/80 bg-white/60 p-1 backdrop-blur dark:border-ink-700 dark:bg-ink-900/40">
        {subNav.map((item) => {
          const Icon = item.icon;
          const active = sub === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSub(item.id)}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
                active
                  ? "bg-emerald-600 text-white shadow"
                  : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {sub === "dashboard" ? (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder={t("automationPage.kbHub.smartSearchPh")}
                className="w-full rounded-xl border border-ink-200 py-2.5 pl-10 pr-3 text-sm dark:border-ink-600 dark:bg-ink-950"
                onKeyDown={(e) => e.key === "Enter" && void runSmartSearch()}
              />
            </div>
            <label className="text-xs font-medium text-ink-600 dark:text-ink-400 lg:min-w-[180px]">
              {t("automationPage.kbHub.searchBot")}
              <select
                value={searchBotId}
                onChange={(e) => setSearchBotId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 px-2 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
              >
                <option value="">{t("automationPage.kbHub.allBots")}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void runSmartSearch()}
              disabled={loading || !searchQ.trim()}
              className="rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-ink-100 dark:text-ink-900"
            >
              {t("automationPage.kbSearch")}
            </button>
          </div>
          {searchResults ? (
            <div className="rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60">
              <p className="text-xs font-semibold text-ink-500">
                {t("automationPage.kbHub.searchResults")} ({searchResults.length})
                {searchMode ? (
                  <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                    {searchMode === "semantic"
                      ? t("automationPage.kbHub.searchModeSemantic")
                      : searchMode === "hybrid"
                        ? t("automationPage.kbHub.searchModeHybrid")
                        : searchMode === "cached"
                          ? t("automationPage.kbHub.searchModeCached")
                          : t("automationPage.kbHub.searchModeLexical")}
                  </span>
                ) : null}
              </p>
              <ul className="mt-3 space-y-2">
                {searchResults.map((a) => {
                  const rank = searchRanking?.find((r) => r.id === a.id);
                  return (
                    <li
                      key={a.id}
                      className="rounded-xl border border-ink-100 bg-ink-50/80 px-3 py-2 dark:border-ink-700 dark:bg-ink-950/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ink-900 dark:text-ink-50">{a.title}</span>
                        {rank != null ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            {t("automationPage.kbHub.score")}: {(rank.score * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                      {rank?.excerpt ? (
                        <p className="mt-1 text-xs text-ink-500 line-clamp-2">{rank.excerpt}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: t("automationPage.kbHub.metricDocs"),
                value: metrics?.totalDocuments ?? articles.length,
                hint: t("automationPage.kbHub.metricDocsHint"),
              },
              {
                label: t("automationPage.kbHub.metricTokens"),
                value: metrics?.estimatedTokens ?? "—",
                hint: t("automationPage.kbHub.metricTokensHint"),
              },
              {
                label: t("automationPage.kbHub.metricChunks"),
                value: metrics?.estimatedChunks ?? "—",
                hint: t("automationPage.kbHub.metricChunksHint"),
              },
              {
                label: t("automationPage.kbHub.metricIndexedChunks"),
                value: metrics?.indexedChunks ?? "—",
                hint:
                  metrics?.semanticSearchReady === true
                    ? t("automationPage.kbHub.metricIndexedChunksHintOn")
                    : t("automationPage.kbHub.metricIndexedChunksHintOff"),
              },
              {
                label: t("automationPage.kbHub.metricSync"),
                value: metrics?.lastUpdatedAt
                  ? new Date(metrics.lastUpdatedAt).toLocaleString()
                  : "—",
                hint: t("automationPage.kbHub.metricSyncHint"),
              },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-ink-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-ink-700 dark:bg-ink-900/50"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{c.label}</p>
                <p className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{c.value}</p>
                <p className="mt-1 text-[11px] text-ink-500">{c.hint}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-ink-200 bg-white/80 p-4 dark:border-ink-700 dark:bg-ink-900/50">
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.kbHub.searchesWeek")}</p>
              <p className="mt-2 text-3xl font-bold text-brand-600">{metrics?.searchesWeek ?? "—"}</p>
              <p className="mt-1 text-xs text-ink-500">
                {metrics?.searchSuccessRate != null
                  ? `${t("automationPage.kbHub.successRate")} ${(metrics.searchSuccessRate * 100).toFixed(0)}%`
                  : t("automationPage.kbHub.noSearchData")}
              </p>
            </div>
            <div className="rounded-2xl border border-ink-200 bg-white/80 p-4 dark:border-ink-700 dark:bg-ink-900/50">
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.kbHub.connectedBots")}</p>
              <p className="mt-2 text-3xl font-bold text-ink-800 dark:text-ink-200">{bots.length}</p>
              <p className="mt-1 text-xs text-ink-500">{t("automationPage.kbHub.connectedBotsHint")}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.kbHub.recentDocs")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(metrics?.documentsPreview ?? articles.slice(0, 6)).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    const a = articles.find((x) => x.id === d.id);
                    if (a) openEditDoc(a);
                  }}
                  className="rounded-2xl border border-ink-200/80 bg-gradient-to-br from-white to-ink-50/50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-ink-700 dark:from-ink-900/80 dark:to-ink-950/80"
                >
                  <p className="font-semibold text-ink-900 dark:text-ink-50 line-clamp-1">{d.title}</p>
                  {"sourceFileName" in d && d.sourceFileName ? (
                    <p className="mt-0.5 text-[10px] text-ink-400 line-clamp-1">{d.sourceFileName}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-ink-500">
                    {"estimatedChunks" in d
                      ? `${d.estimatedChunks} chunks · ${d.estimatedTokens} tok`
                      : "—"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.category ? (
                      <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-200">
                        {d.category}
                      </span>
                    ) : null}
                    {"syncToAi" in d && d.syncToAi ? (
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        RAG
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                    {t("automationPage.kbHub.open")} <ChevronRight className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {sub === "documents" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              placeholder={t("automationPage.kbHub.filterDocs")}
              className="min-w-[200px] flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            >
              <option value="all">{t("automationPage.kbHub.allCategories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredDocs.map((a) => {
              const chunks = Math.max(1, Math.ceil(a.content.length / 1500));
              const tok = Math.round(a.content.length / 4);
              return (
                <div
                  key={a.id}
                  className="group rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm transition hover:border-emerald-500/30 hover:shadow-lg dark:border-ink-700 dark:bg-ink-900/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-ink-900 dark:text-ink-50 line-clamp-2">{a.title}</h3>
                      <p className="mt-1 text-[11px] text-ink-500">
                        {t("automationPage.kbHub.docType")} · {a.category || t("automationPage.kbHub.uncategorized")}
                      </p>
                      {a.sourceFileName ? (
                        <p className="mt-0.5 text-[10px] text-ink-400 line-clamp-1" title={a.sourceFileName}>
                          {t("automationPage.kbHub.importSource")}: {a.sourceFileName}
                        </p>
                      ) : null}
                    </div>
                    <FileText className="h-8 w-8 shrink-0 text-emerald-500/80" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(a.tags ?? []).slice(0, 4).map((tg) => (
                      <span
                        key={tg}
                        className="rounded-md bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300"
                      >
                        {tg}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-ink-500">
                    {chunks} {t("automationPage.kbHub.chunks")} · {tok} tok ·{" "}
                    {a.updatedAt ? new Date(a.updatedAt).toLocaleString() : "—"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
                    <button
                      type="button"
                      onClick={() => openEditDoc(a)}
                      className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-ink-100 dark:text-ink-900"
                    >
                      {t("automationPage.kbEdit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteKb(a.id)}
                      className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs dark:border-ink-600"
                    >
                      {t("automationPage.kbDelete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runReindexArticle(a.id)}
                      className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:text-emerald-200"
                    >
                      {t("automationPage.kbHub.reindexDoc")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredDocs.length === 0 ? (
            <p className="text-center text-sm text-ink-500">{t("automationPage.kbHub.noDocs")}</p>
          ) : null}
        </div>
      ) : null}

      {sub === "categories" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60">
            <h3 className="text-sm font-semibold">{t("automationPage.kbHub.categoriesTitle")}</h3>
            <ul className="mt-3 space-y-2">
              {categories.length === 0 ? (
                <li className="text-xs text-ink-500">{t("automationPage.kbHub.noCategories")}</li>
              ) : (
                categories.map((c) => (
                  <li
                    key={c}
                    className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 dark:border-ink-800"
                  >
                    <span className="text-sm font-medium">{c}</span>
                    <span className="text-xs text-ink-500">
                      {articles.filter((a) => (a.category ?? "").trim() === c).length}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60">
            <h3 className="text-sm font-semibold">{t("automationPage.kbHub.tagsCloud")}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {allTags.slice(0, 40).map(([tag, n]) => (
                <span
                  key={tag}
                  className="rounded-full bg-gradient-to-r from-violet-500/15 to-sky-500/15 px-3 py-1 text-xs font-medium text-ink-800 dark:text-ink-200"
                >
                  {tag}
                  <span className="ml-1 text-ink-400">×{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {sub === "sources" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCE_PRESETS.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className="rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 p-4 opacity-80 dark:border-ink-600 dark:bg-ink-900/30"
              >
                <Icon className="h-8 w-8 text-ink-400" />
                <p className="mt-2 font-semibold text-ink-800 dark:text-ink-200">
                  {t(`automationPage.kbHub.source_${s.key}`)}
                </p>
                <p className="mt-1 text-xs text-ink-500">{t("automationPage.kbHub.sourceSoon")}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {sub === "rag" ? (
        <div className="space-y-4 rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60">
          <p className="text-sm text-ink-600 dark:text-ink-400">{t("automationPage.kbHub.ragIntro")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium">
              {t("automationPage.kbHub.chunkSize")}
              <input
                value={ragChunk}
                onChange={(e) => setRagChunk(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs font-medium">
              {t("automationPage.kbHub.overlap")}
              <input
                value={ragOverlap}
                onChange={(e) => setRagOverlap(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs font-medium">
              {t("automationPage.kbHub.threshold")}
              <input
                value={ragThreshold}
                onChange={(e) => setRagThreshold(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={persistRagPrefs}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t("automationPage.kbHub.saveRagPrefs")}
          </button>
          <p className="text-[11px] text-ink-500">{t("automationPage.kbHub.ragNote")}</p>
        </div>
      ) : null}

      {sub === "playground" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-3 rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60 lg:col-span-2">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.kbHub.playgroundTitle")}</h3>
            <textarea
              value={pgQuery}
              onChange={(e) => setPgQuery(e.target.value)}
              rows={4}
              placeholder={t("automationPage.kbHub.playgroundPh")}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
            <label className="block text-xs">
              {t("automationPage.kbHub.pgBot")}
              <select
                value={pgBotId}
                onChange={(e) => setPgBotId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              >
                <option value="">{t("automationPage.kbHub.allBots")}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              {t("automationPage.promptHub.previewProvider")}
              <select
                value={pgProvider}
                onChange={(e) => {
                  const p = e.target.value as "openai" | "google_gemini";
                  setPgProvider(p);
                  if (p === "google_gemini") setPgModel("gemini-1.5-flash");
                  else setPgModel("gpt-4o-mini");
                }}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              >
                <option value="openai">OpenAI / compatível</option>
                <option value="google_gemini">Google Gemini</option>
              </select>
            </label>
            <label className="block text-xs">
              Model
              <input
                value={pgModel}
                onChange={(e) => setPgModel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            {pgProvider === "openai" ? (
              <label className="block text-xs">
                API base
                <input
                  value={pgBaseUrl}
                  onChange={(e) => setPgBaseUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
                />
              </label>
            ) : null}
            <label className="block text-xs">
              {t("automationPage.promptHub.previewApiKey")}
              <input
                type="password"
                autoComplete="off"
                value={pgApiKey}
                onChange={(e) => setPgApiKey(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <button
              type="button"
              disabled={pgBusy || !pgQuery.trim()}
              onClick={() => void runPlayground()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("automationPage.kbHub.runPlayground")}
            </button>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-ink-50/80 p-4 dark:border-ink-700 dark:bg-ink-950/50 lg:col-span-3">
            <p className="text-xs font-semibold text-ink-500">{t("automationPage.kbHub.pgAnswer")}</p>
            {pgMeta ? <p className="mt-1 text-[11px] text-ink-400">{pgMeta}</p> : null}
            <div className="mt-3 min-h-[120px] rounded-xl border border-ink-200 bg-white p-3 text-sm dark:border-ink-600 dark:bg-ink-900">
              {pgAnswer ? (
                <div dangerouslySetInnerHTML={{ __html: naiveMdToHtml(pgAnswer) }} />
              ) : (
                <p className="text-ink-400">{t("automationPage.kbHub.pgEmpty")}</p>
              )}
            </div>
            <p className="mt-4 text-xs font-semibold text-ink-600">{t("automationPage.kbHub.pgSources")}</p>
            <ul className="mt-2 space-y-2">
              {pgSources.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-emerald-200/60 bg-emerald-500/5 px-3 py-2 text-xs dark:border-emerald-800/50"
                >
                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">✓ {s.title}</span>
                  <span className="ml-2 text-ink-500">
                    {t("automationPage.kbHub.score")}: {(s.score * 100).toFixed(0)}%
                  </span>
                  <p className="mt-1 text-ink-500 line-clamp-2">{s.excerpt}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {sub === "history" ? (
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            {t("automationPage.kbHub.pickArticle")}
            <select
              value={historyArticleId ?? ""}
              onChange={(e) => void loadRevisions(e.target.value)}
              className="mt-1 w-full max-w-md rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-600 dark:bg-ink-950"
            >
              <option value="">{t("automationPage.kbHub.selectDoc")}</option>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.id} className="rounded-xl border border-ink-200 bg-white/90 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900/60">
                <span className="text-xs text-ink-500">
                  {new Date(r.createdAt).toLocaleString()} · {r.editor.name ?? "—"}
                </span>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-ink-600">
                  {JSON.stringify(r.snapshot, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sub === "analytics" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-200 bg-white/90 p-4 dark:border-ink-700 dark:bg-ink-900/60">
            <h3 className="text-sm font-semibold">{t("automationPage.kbHub.topQueries")}</h3>
            <ul className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
              {(metrics?.topQueries ?? []).map((q) => (
                <li key={q.query} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium text-ink-800 dark:text-ink-200">{q.query}</span>
                  <span className="text-xs text-ink-500">
                    {q.count}× · {t("automationPage.kbHub.avgHits")}: {q.avgResults.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            {!metrics?.topQueries.length ? (
              <p className="text-xs text-ink-500">{t("automationPage.kbHub.noAnalytics")}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="fixed inset-0 z-[65] flex flex-col bg-ink-950/75 p-3 backdrop-blur-md sm:p-5">
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3 dark:border-ink-700">
              <h3 className="text-lg font-bold text-ink-900 dark:text-ink-50">
                {kbForm.id ? t("automationPage.kbEdit") : t("automationPage.kbNew")}
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditorPreview((p) => !p)}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                >
                  {editorPreview ? t("automationPage.kbHub.editMode") : t("automationPage.kbHub.previewMode")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs dark:border-ink-600"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={loading || !kbForm.title.trim() || !kbForm.content.trim()}
                  onClick={() => void saveKb()}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t("automationPage.kbSave")}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium">
                  {t("automationPage.kbTitle")}
                  <input
                    value={kbForm.title}
                    onChange={(e) => setKbForm((f) => ({ ...f, title: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-900"
                  />
                </label>
                <label className="text-xs font-medium">
                  {t("automationPage.kbCategory")}
                  <input
                    value={kbForm.category}
                    onChange={(e) => setKbForm((f) => ({ ...f, category: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-900"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium">
                {t("automationPage.kbTags")}
                <input
                  value={kbForm.tags}
                  onChange={(e) => setKbForm((f) => ({ ...f, tags: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-900"
                />
              </label>
              {kbForm.sourceFileName ? (
                <p className="mt-2 text-[11px] text-ink-500">
                  {t("automationPage.kbHub.importSource")}:{" "}
                  <span className="font-medium text-ink-700 dark:text-ink-300">{kbForm.sourceFileName}</span>
                </p>
              ) : null}
              {!editorPreview ? (
                <textarea
                  value={kbForm.content}
                  onChange={(e) => setKbForm((f) => ({ ...f, content: e.target.value }))}
                  rows={18}
                  className="mt-3 w-full resize-y rounded-xl border border-ink-200 bg-ink-950 px-3 py-3 font-mono text-sm leading-relaxed text-ink-100 dark:border-ink-700"
                  placeholder={t("automationPage.kbHub.editorPlaceholder")}
                />
              ) : (
                <div
                  className="mt-3 max-w-none rounded-xl border border-ink-200 bg-white p-4 text-sm text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                  dangerouslySetInnerHTML={{ __html: naiveMdToHtml(kbForm.content || "—") }}
                />
              )}
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={kbForm.isActive}
                    onChange={(e) => setKbForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  {t("automationPage.kbActive")}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={kbForm.syncToAi}
                    onChange={(e) => setKbForm((f) => ({ ...f, syncToAi: e.target.checked }))}
                  />
                  {t("automationPage.kbSyncAi")}
                </label>
              </div>
              <fieldset className="mt-3">
                <legend className="text-xs font-medium">{t("automationPage.kbBots")}</legend>
                <div className="mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto rounded border p-2 dark:border-ink-700">
                  {bots.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={kbForm.botIds.includes(b.id)}
                        onChange={(e) =>
                          setKbForm((f) => ({
                            ...f,
                            botIds: e.target.checked ? [...f.botIds, b.id] : f.botIds.filter((id) => id !== b.id),
                          }))
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
