import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Microscope, Play } from "lucide-react";
import { api } from "@/lib/api";

type InspectorChunk = {
  id: string;
  documentName: string;
  excerpt: string;
  score: number;
  similarity?: number;
};

type InspectorTrace = {
  query: string;
  provider: string;
  appendix: string;
  latencyMs: number;
  fromCache: boolean;
  documents: Array<{ id: string; name: string; category: string | null }>;
  chunks: InspectorChunk[];
  rerankedChunks: InspectorChunk[];
  citations: Array<{ documentName: string; excerpt: string; score: number }>;
  events: Array<{ action: string; chunkCount: number; documentCount: number }>;
};

type BotOption = { id: string; name: string };

export function KnowledgeInspectorPanel({
  t,
  bots,
}: {
  t: (key: string) => string;
  bots: BotOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [botId, setBotId] = useState("");
  const [provider, setProvider] = useState<"openconduit" | "llamaindex">("openconduit");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<InspectorTrace | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError("");
    try {
      const res = await api.post<{ data: InspectorTrace }>("/automation/knowledge-engine/inspector", {
        query: query.trim(),
        botId: botId || undefined,
        provider,
      });
      setTrace(res.data);
    } catch {
      setError("inspector_failed");
      setTrace(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/20 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
          <Microscope className="h-4 w-4 text-indigo-600" />
          {t("automationPage.knowledgeInspectorTitle")}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.knowledgeInspectorHelp")}</p>

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeInspectorQuery")}</span>
              <textarea
                rows={2}
                className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("automationPage.knowledgeInspectorQueryPlaceholder")}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeInspectorBot")}</span>
              <select
                className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
              >
                <option value="">{t("automationPage.knowledgeInspectorBotAll")}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineProviderLabel")}</span>
              <select
                className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
              >
                <option value="openconduit">{t("automationPage.knowledgeEngineProvider_openconduit")}</option>
                <option value="llamaindex">{t("automationPage.knowledgeEngineProvider_llamaindex")}</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={running || !query.trim()}
            onClick={() => void run()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t("automationPage.knowledgeInspectorRun")}
          </button>

          {error ? <p className="text-xs text-red-600">{t("automationPage.knowledgeInspectorError")}</p> : null}

          {trace ? (
            <div className="space-y-3 border-t border-indigo-200/60 pt-3 dark:border-indigo-900/50">
              <div className="flex flex-wrap gap-2 text-[11px] text-ink-500">
                <span>
                  {t("automationPage.knowledgeInspectorProvider")}: <strong>{trace.provider}</strong>
                </span>
                <span>
                  {t("automationPage.knowledgeInspectorLatency")}: <strong>{trace.latencyMs}ms</strong>
                </span>
                {trace.fromCache ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    cache
                  </span>
                ) : null}
              </div>

              <InspectorSection title={t("automationPage.knowledgeInspectorDocuments")} count={trace.documents.length}>
                {trace.documents.map((d) => (
                  <div key={d.id} className="rounded border border-ink-100 px-2 py-1 text-xs dark:border-ink-800">
                    <strong>{d.name}</strong>
                    {d.category ? <span className="ml-2 text-ink-400">({d.category})</span> : null}
                  </div>
                ))}
              </InspectorSection>

              <InspectorSection title={t("automationPage.knowledgeInspectorChunks")} count={trace.chunks.length}>
                {trace.chunks.map((c) => (
                  <div key={c.id} className="rounded border border-ink-100 px-2 py-1.5 text-xs dark:border-ink-800">
                    <div className="flex justify-between gap-2">
                      <strong>{c.documentName}</strong>
                      <span className="text-ink-400">score {Math.round(c.score * 1000) / 1000}</span>
                    </div>
                    <p className="mt-1 text-ink-600 dark:text-ink-400">{c.excerpt}</p>
                  </div>
                ))}
              </InspectorSection>

              {trace.rerankedChunks.length > 0 && trace.rerankedChunks !== trace.chunks ? (
                <InspectorSection
                  title={t("automationPage.knowledgeInspectorRerank")}
                  count={trace.rerankedChunks.length}
                >
                  {trace.rerankedChunks.map((c) => (
                    <div key={`r-${c.id}`} className="text-xs text-ink-600 dark:text-ink-400">
                      {c.documentName} — {Math.round(c.score * 1000) / 1000}
                    </div>
                  ))}
                </InspectorSection>
              ) : null}

              {trace.appendix ? (
                <InspectorSection title={t("automationPage.knowledgeInspectorContext")}>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-[11px] dark:bg-ink-900">
                    {trace.appendix}
                  </pre>
                </InspectorSection>
              ) : null}

              {trace.citations.length > 0 ? (
                <InspectorSection title={t("automationPage.knowledgeInspectorCitations")} count={trace.citations.length}>
                  {trace.citations.map((c, i) => (
                    <div key={i} className="text-xs">
                      <strong>{c.documentName}</strong>: {c.excerpt.slice(0, 120)}…
                    </div>
                  ))}
                </InspectorSection>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InspectorSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div>
      <h5 className="text-xs font-semibold text-ink-800 dark:text-ink-200">
        {title}
        {count != null ? ` (${count})` : ""}
      </h5>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  );
}
