import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Database, Loader2, Save, Settings2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

type OrgKnowledgeConfig = {
  provider: "openconduit" | "llamaindex";
  maxDocuments: number;
  maxChunks: number;
  minScore: number;
  minSimilarity: number;
  autoIndex: boolean;
  cacheEnabled: boolean;
  reranking: boolean;
  citations: boolean;
};

type CacheStats = { queryEntries: number; embeddingEntries: number };

export function KnowledgeAdminPanel({ t }: { t: (key: string) => string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [config, setConfig] = useState<OrgKnowledgeConfig | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{
        data: { config: OrgKnowledgeConfig; cacheStats: CacheStats };
      }>("/automation/knowledge-engine/admin");
      setConfig(res.data.config);
      setCacheStats(res.data.cacheStats);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      await api.patch("/automation/knowledge-engine/admin", config);
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const clearCache = async () => {
    setClearing(true);
    setError("");
    try {
      await api.post("/automation/knowledge-engine/admin/clear-cache", {});
      await load();
    } catch {
      setError("clear_failed");
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("automationPage.knowledgeAdminLoading")}
      </div>
    );
  }

  if (!config) {
    return <p className="text-sm text-red-600">{t("automationPage.knowledgeAdminError")}</p>;
  }

  return (
    <div className="rounded-xl border border-sky-200/70 bg-sky-50/20 p-4 dark:border-sky-900/40 dark:bg-sky-950/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
            <Settings2 className="h-4 w-4 text-sky-600" />
            {t("automationPage.knowledgeAdminTitle")}
          </h4>
          <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.knowledgeAdminHelp")}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={clearing}
            onClick={() => void clearCache()}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-semibold dark:border-ink-700"
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {t("automationPage.knowledgeAdminClearCache")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t("automationPage.knowledgeAdminSave")}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{t("automationPage.knowledgeAdminError")}</p> : null}

      {cacheStats ? (
        <p className="mt-2 text-[11px] text-ink-500">
          {t("automationPage.knowledgeAdminCacheStats")
            .replace("{queries}", String(cacheStats.queryEntries))
            .replace("{embeddings}", String(cacheStats.embeddingEntries))}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineProviderLabel")}</span>
          <select
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.provider}
            onChange={(e) =>
              setConfig((c) =>
                c ? { ...c, provider: e.target.value as OrgKnowledgeConfig["provider"] } : c,
              )
            }
          >
            <option value="openconduit">{t("automationPage.knowledgeEngineProvider_openconduit")}</option>
            <option value="llamaindex">{t("automationPage.knowledgeEngineProvider_llamaindex")}</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineMaxDocuments")}</span>
          <input
            type="number"
            min={1}
            max={50}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.maxDocuments}
            onChange={(e) =>
              setConfig((c) =>
                c ? { ...c, maxDocuments: Math.min(50, Math.max(1, Number(e.target.value) || 10)) } : c,
              )
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineMaxChunks")}</span>
          <input
            type="number"
            min={1}
            max={100}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.maxChunks}
            onChange={(e) =>
              setConfig((c) =>
                c ? { ...c, maxChunks: Math.min(100, Math.max(1, Number(e.target.value) || 20)) } : c,
              )
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeAdminMinScore")}</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.minScore}
            onChange={(e) =>
              setConfig((c) =>
                c ? { ...c, minScore: Math.min(1, Math.max(0, Number(e.target.value) || 0.25)) } : c,
              )
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeAdminMinSimilarity")}</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.minSimilarity}
            onChange={(e) =>
              setConfig((c) =>
                c ? { ...c, minSimilarity: Math.min(1, Math.max(0, Number(e.target.value) || 0.2)) } : c,
              )
            }
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        {(
          [
            ["autoIndex", "knowledgeAdminAutoIndex"],
            ["cacheEnabled", "knowledgeAdminCacheEnabled"],
            ["reranking", "knowledgeEngineReranking"],
            ["citations", "knowledgeEngineCitations"],
          ] as const
        ).map(([key, labelKey]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config[key]}
              onChange={(e) => setConfig((c) => (c ? { ...c, [key]: e.target.checked } : c))}
            />
            {t(`automationPage.${labelKey}`)}
          </label>
        ))}
      </div>
    </div>
  );
}

type CenterMetrics = {
  documents: number;
  chunks: number;
  tokenEstimate: number;
  categories: Array<{ name: string; count: number }>;
  lastIndexedAt: string | null;
  lastDocumentName: string | null;
};

export function KnowledgeCenterPanel({ t }: { t: (key: string) => string }) {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<CenterMetrics | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await api.get<{ data: CenterMetrics }>("/automation/knowledge-engine/center");
        setMetrics(res.data);
      } catch {
        setMetrics(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("automationPage.knowledgeCenterLoading")}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="rounded-xl border border-ink-200/80 bg-white/60 p-4 dark:border-ink-700 dark:bg-ink-950/40">
      <h4 className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
        <Database className="h-4 w-4 text-sky-600" />
        {t("automationPage.knowledgeCenterTitle")}
      </h4>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["documents", metrics.documents],
            ["chunks", metrics.chunks],
            ["tokens", metrics.tokenEstimate],
            ["categories", metrics.categories.length],
          ] as const
        ).map(([key, val]) => (
          <div
            key={key}
            className={clsx(
              "rounded-lg border border-ink-100 px-3 py-2 text-center dark:border-ink-800",
            )}
          >
            <div className="text-lg font-bold text-ink-900 dark:text-ink-50">{val.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">
              {t(`automationPage.knowledgeCenterStat_${key}`)}
            </div>
          </div>
        ))}
      </div>
      {metrics.lastIndexedAt ? (
        <p className="mt-2 text-[11px] text-ink-500">
          {t("automationPage.knowledgeCenterLastIndex")
            .replace("{name}", metrics.lastDocumentName ?? "—")
            .replace("{date}", new Date(metrics.lastIndexedAt).toLocaleString())}
        </p>
      ) : null}
    </div>
  );
}
