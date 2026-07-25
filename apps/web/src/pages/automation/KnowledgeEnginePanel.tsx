import clsx from "clsx";
import { BookOpen, Layers, Search, Sparkles } from "lucide-react";

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
});

type Props = {
  value: KnowledgeEngineFormValues;
  onChange: (next: KnowledgeEngineFormValues) => void;
  t: (key: string) => string;
};

export function KnowledgeEnginePanel({ value, onChange, t }: Props) {
  const patch = (p: Partial<KnowledgeEngineFormValues>) => onChange({ ...value, ...p });
  const isLlamaIndex = value.provider === "llamaindex";

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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineMaxDocuments")}</span>
          <input
            type="number"
            min={1}
            max={50}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={value.maxDocuments}
            onChange={(e) =>
              patch({ maxDocuments: Math.min(50, Math.max(1, Number(e.target.value) || 10)) })
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
            value={value.maxChunks}
            onChange={(e) =>
              patch({ maxChunks: Math.min(100, Math.max(1, Number(e.target.value) || 20)) })
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineSearchTemperature")}</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={value.searchTemperature}
            onChange={(e) =>
              patch({ searchTemperature: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineChunkSize")}</span>
          <input
            type="number"
            min={200}
            max={4000}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={value.chunkSize}
            onChange={(e) =>
              patch({ chunkSize: Math.min(4000, Math.max(200, Number(e.target.value) || 900)) })
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.knowledgeEngineChunkOverlap")}</span>
          <input
            type="number"
            min={0}
            max={800}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={value.chunkOverlap}
            onChange={(e) =>
              patch({ chunkOverlap: Math.min(800, Math.max(0, Number(e.target.value) || 120)) })
            }
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
