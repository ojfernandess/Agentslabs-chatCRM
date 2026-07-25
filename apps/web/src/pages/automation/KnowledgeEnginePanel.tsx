import clsx from "clsx";
import { BookOpen, Layers, Loader2, RefreshCw, Search, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type KnowledgeEngineProviderOption = "openconduit" | "llamaindex";

export type KnowledgeEngineFormValues = {
  provider: KnowledgeEngineProviderOption;
  enabled: boolean;
  semanticSearch: boolean;
  reranking: boolean;
  citations: boolean;
  maxDocuments: number;
  maxChunks: number;
  searchTemperature: number;
  chunkSize: number;
  chunkOverlap: number;
  autoChunk: boolean;
  useRecommendedSettings: boolean;
  /** Omitir KB em confirmações curtas / cadastro (behaviorConfig.knowledgeSearchSkip.enabled). */
  skipOnFlowRepliesEnabled: boolean;
  /** Instrução quando a KB é omitida; vazio = padrão do sistema. */
  skipOnFlowRepliesInstruction: string;
};

export const defaultKnowledgeEngineFormValues = (): KnowledgeEngineFormValues => ({
  provider: "openconduit",
  enabled: true,
  semanticSearch: true,
  reranking: true,
  citations: true,
  maxDocuments: 10,
  maxChunks: 20,
  searchTemperature: 0,
  chunkSize: 900,
  chunkOverlap: 120,
  autoChunk: true,
  useRecommendedSettings: false,
  skipOnFlowRepliesEnabled: true,
  skipOnFlowRepliesInstruction: "",
});

type RecommendationPayload = {
  maxDocuments: number;
  maxChunks: number;
  searchTemperature: number;
  chunkSize: number;
  chunkOverlap: number;
  stats: {
    documentCount: number;
    totalChars: number;
    avgDocChars: number;
    indexedChunkCount: number;
    estimatedChunkCount: number;
    scopedToBot: boolean;
  };
};

type Props = {
  value: KnowledgeEngineFormValues;
  onChange: (next: KnowledgeEngineFormValues) => void;
  t: (key: string) => string;
  botId?: string;
  /** `nativeTools.knowledge_search` — desactiva secção quando a tool KB está off. */
  knowledgeSearchEnabled?: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function KnowledgeNumericField({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-") {
      setDraft(String(value));
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clamp(step ? Math.round(n / step) * step : n, min, max);
    onChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx(
        "w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950",
        disabled && "cursor-not-allowed opacity-70",
      )}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
      }}
    />
  );
}

export function KnowledgeEnginePanel({ value, onChange, t, botId, knowledgeSearchEnabled = true }: Props) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const patch = (p: Partial<KnowledgeEngineFormValues>) => onChange({ ...valueRef.current, ...p });
  const isLlamaIndex = value.provider === "llamaindex";
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recStats, setRecStats] = useState<RecommendationPayload["stats"] | null>(null);

  const applyRecommendation = useCallback(async () => {
    if (!isLlamaIndex) return;
    setRecLoading(true);
    setRecError("");
    try {
      const qs = botId ? `?botId=${encodeURIComponent(botId)}` : "";
      const res = await api.get<{ data: RecommendationPayload }>(
        `/automation/knowledge-engine/recommendations${qs}`,
      );
      const data = res.data;
      setRecStats(data.stats);
      onChangeRef.current({
        ...valueRef.current,
        maxDocuments: data.maxDocuments,
        maxChunks: data.maxChunks,
        searchTemperature: data.searchTemperature,
        chunkSize: data.chunkSize,
        chunkOverlap: data.chunkOverlap,
      });
    } catch {
      setRecError(t("automationPage.knowledgeEngineRecommendationError"));
    } finally {
      setRecLoading(false);
    }
  }, [botId, isLlamaIndex, t]);

  useEffect(() => {
    if (!isLlamaIndex || !value.useRecommendedSettings) {
      setRecStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setRecLoading(true);
      setRecError("");
      try {
        const qs = botId ? `?botId=${encodeURIComponent(botId)}` : "";
        const res = await api.get<{ data: RecommendationPayload }>(
          `/automation/knowledge-engine/recommendations${qs}`,
        );
        if (cancelled) return;
        const data = res.data;
        setRecStats(data.stats);
        onChangeRef.current({
          ...valueRef.current,
          maxDocuments: data.maxDocuments,
          maxChunks: data.maxChunks,
          searchTemperature: data.searchTemperature,
          chunkSize: data.chunkSize,
          chunkOverlap: data.chunkOverlap,
        });
      } catch {
        if (!cancelled) setRecError(t("automationPage.knowledgeEngineRecommendationError"));
      } finally {
        if (!cancelled) setRecLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [botId, isLlamaIndex, t, value.useRecommendedSettings]);

  const fieldsDisabled = value.useRecommendedSettings || recLoading;

  return (
    <div className="rounded-xl border border-sky-200/70 bg-sky-50/30 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
      <div>
        <h4 className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
          <BookOpen className="h-4 w-4 text-sky-600" />
          {t("automationPage.knowledgeEngineTitle")}
        </h4>
        <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.knowledgeEngineHelp")}</p>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-ink-800 dark:text-ink-200">
          {t("automationPage.knowledgeEngineProviderLabel")}
        </legend>
        <div className="mt-2 space-y-1.5">
          {(["openconduit", "llamaindex"] as const).map((id) => (
            <label
              key={id}
              className={clsx(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
                value.provider === id
                  ? "border-sky-400 bg-white dark:border-sky-600 dark:bg-ink-950"
                  : "border-transparent hover:bg-white/60 dark:hover:bg-ink-950/40",
              )}
            >
              <input
                type="radio"
                name="knowledgeEngineProvider"
                checked={value.provider === id}
                onChange={() => patch({ provider: id })}
              />
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              <span>{t(`automationPage.knowledgeEngineProvider_${id}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 border-t border-sky-200/60 pt-4 dark:border-sky-900/50">
        <p className="text-[11px] text-ink-500">{t("automationPage.knowledgeEngineLegacyNote")}</p>
      </div>

      <div
        className={clsx(
          "mt-4 space-y-3 rounded-lg border border-sky-200/80 bg-white/70 p-3 dark:border-sky-800/60 dark:bg-ink-950/40",
          !knowledgeSearchEnabled && "opacity-60",
        )}
      >
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.skipOnFlowRepliesEnabled}
            disabled={!knowledgeSearchEnabled}
            onChange={(e) => patch({ skipOnFlowRepliesEnabled: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-ink-800 dark:text-ink-100">
              {t("automationPage.knowledgeSearchSkipToggle")}
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-500">
              {t("automationPage.knowledgeSearchSkipHelp")}
            </span>
          </span>
        </label>
        {value.skipOnFlowRepliesEnabled && knowledgeSearchEnabled ? (
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-700 dark:text-ink-300">
              {t("automationPage.knowledgeSearchSkipInstructionLabel")}
            </label>
            <textarea
              rows={3}
              value={value.skipOnFlowRepliesInstruction}
              onChange={(e) => patch({ skipOnFlowRepliesInstruction: e.target.value.slice(0, 2000) })}
              placeholder={t("automationPage.knowledgeSearchSkipInstructionPlaceholder")}
              className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-xs text-ink-900 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
            />
            <p className="mt-1 text-[10px] text-ink-500">{t("automationPage.knowledgeSearchSkipInstructionHint")}</p>
          </div>
        ) : null}
        {!knowledgeSearchEnabled ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {t("automationPage.knowledgeSearchSkipRequiresKbTool")}
          </p>
        ) : null}
      </div>

      {isLlamaIndex ? (
        <>
          <div className="mt-4 space-y-3 border-t border-sky-200/60 pt-4 dark:border-sky-900/50">
            {(
              [
                ["semanticSearch", "knowledgeEngineSemanticSearch"],
                ["reranking", "knowledgeEngineReranking"],
                ["citations", "knowledgeEngineCitations"],
                ["autoChunk", "knowledgeEngineAutoChunk"],
              ] as const
            ).map(([key, labelKey]) => (
              <label key={key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={value[key]}
                  onChange={(e) => patch({ [key]: e.target.checked })}
                />
                {t(`automationPage.${labelKey}`)}
              </label>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-sky-200/80 bg-white/70 p-3 dark:border-sky-800/60 dark:bg-ink-950/40">
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.useRecommendedSettings}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  patch({ useRecommendedSettings: enabled });
                  if (enabled) void applyRecommendation();
                }}
              />
              <span>
                <span className="inline-flex items-center gap-1 font-semibold text-ink-800 dark:text-ink-100">
                  <Wand2 className="h-3.5 w-3.5 text-sky-600" />
                  {t("automationPage.knowledgeEngineRecommendationMode")}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-ink-500">
                  {t("automationPage.knowledgeEngineRecommendationHelp")}
                </span>
              </span>
            </label>
            {value.useRecommendedSettings ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={recLoading}
                  onClick={() => void applyRecommendation()}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-60 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200"
                >
                  {recLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t("automationPage.knowledgeEngineRecommendationRefresh")}
                </button>
                {recStats ? (
                  <span className="text-[11px] text-ink-500">
                    {t("automationPage.knowledgeEngineRecommendationStats")
                      .replace("{docs}", String(recStats.documentCount))
                      .replace("{chunks}", String(recStats.estimatedChunkCount))
                      .replace("{chars}", String(recStats.totalChars))}
                  </span>
                ) : null}
              </div>
            ) : null}
            {recError ? <p className="mt-2 text-[11px] text-red-600">{recError}</p> : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineMaxDocuments")}</span>
              <KnowledgeNumericField
                value={value.maxDocuments}
                min={1}
                max={50}
                disabled={fieldsDisabled}
                onChange={(maxDocuments) => patch({ maxDocuments })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineMaxChunks")}</span>
              <KnowledgeNumericField
                value={value.maxChunks}
                min={1}
                max={100}
                disabled={fieldsDisabled}
                onChange={(maxChunks) => patch({ maxChunks })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineSearchTemperature")}</span>
              <KnowledgeNumericField
                value={value.searchTemperature}
                min={0}
                max={1}
                step={0.1}
                disabled={fieldsDisabled}
                onChange={(searchTemperature) => patch({ searchTemperature })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineChunkSize")}</span>
              <KnowledgeNumericField
                value={value.chunkSize}
                min={200}
                max={4000}
                disabled={fieldsDisabled}
                onChange={(chunkSize) => patch({ chunkSize })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineChunkOverlap")}</span>
              <KnowledgeNumericField
                value={value.chunkOverlap}
                min={0}
                max={800}
                disabled={fieldsDisabled}
                onChange={(chunkOverlap) => patch({ chunkOverlap })}
              />
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function KnowledgeEnginePanelCompactHint({ t }: { t: (key: string) => string }) {
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-ink-500">
      <Layers className="h-3 w-3" />
      {t("automationPage.knowledgeEngineCompactHint")}
    </p>
  );
}

export function KnowledgeEngineSearchIcon() {
  return <Search className="h-3.5 w-3.5" />;
}
