import { useMemo, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Code2, Database, Sparkles } from "lucide-react";
import { EIL_FACT_CATALOG } from "@/lib/eil/catalog.js";
import { inferToolEilFromSchema, parameterFactSuggestions } from "@/lib/eil/inferToolEilFromSchema.js";
import { parseToolEilJson, type ToolEilConfigDraft } from "@/lib/eil/toolConfig.js";
import { EilHelpHint, type EilHelpSection } from "./EilHelpHint.js";

type Translate = (key: string) => string;
type TabId = "visual" | "json";

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: Translate;
  locale: "pt" | "en";
  helpSections: EilHelpSection[];
  toolName?: string;
  parametersSchemaJson?: string;
};

function draftFromJson(json: string): ToolEilConfigDraft {
  const parsed = parseToolEilJson(json);
  return parsed.ok ? parsed.value : {};
}

function draftToJson(draft: ToolEilConfigDraft): string {
  const out: ToolEilConfigDraft = {};
  if (draft.produces?.length) out.produces = draft.produces;
  if (draft.requiresFacts?.length) out.requiresFacts = draft.requiresFacts;
  if (draft.capabilities?.length) out.capabilities = draft.capabilities;
  if (draft.factPaths && Object.keys(draft.factPaths).length > 0) out.factPaths = draft.factPaths;
  return JSON.stringify(out, null, 2);
}

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function unionLineList(existing: string[] | undefined, value: string): string[] {
  const set = new Set(existing ?? []);
  set.add(value);
  return [...set];
}

export function ToolEilVisualBuilder({
  enabled,
  onEnabledChange,
  json,
  onJsonChange,
  t,
  locale,
  helpSections,
  toolName = "",
  parametersSchemaJson = "{}",
}: Props) {
  const [tab, setTab] = useState<TabId>("visual");
  const [autoConfigNote, setAutoConfigNote] = useState<string | null>(null);
  const draft = useMemo(() => draftFromJson(json), [json]);
  const parsed = useMemo(() => (enabled ? parseToolEilJson(json) : null), [enabled, json]);

  const parametersSchema = useMemo(() => {
    try {
      return JSON.parse(parametersSchemaJson || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [parametersSchemaJson]);

  const paramSuggestions = useMemo(() => parameterFactSuggestions(parametersSchema), [parametersSchema]);

  const syncDraft = (next: ToolEilConfigDraft) => onJsonChange(draftToJson(next));

  const runAutoConfig = () => {
    let schema: Record<string, unknown>;
    try {
      schema = JSON.parse(parametersSchemaJson || "{}") as Record<string, unknown>;
    } catch {
      setAutoConfigNote(t("automationPage.toolEilAutoConfigInvalidParams"));
      return;
    }
    const result = inferToolEilFromSchema({
      toolName: toolName.trim(),
      parametersSchema: schema,
      existing: draft,
    });
    if (!enabled) onEnabledChange(true);
    syncDraft(result.draft);
    const parts = [
      t("automationPage.toolEilAutoConfigDone"),
      result.summary.fromPreset ? t("automationPage.toolEilAutoConfigUsedPreset") : null,
      result.summary.paramProperties > 0
        ? t("automationPage.toolEilAutoConfigParams").replace("{count}", String(result.summary.paramProperties))
        : null,
    ].filter(Boolean);
    setAutoConfigNote(parts.join(" · "));
  };

  const validationMessage = (() => {
    if (!enabled || !parsed) return null;
    if (parsed.ok) return null;
    const map: Record<string, string> = {
      json: t("automationPage.toolEilInvalidJson"),
      object: t("automationPage.toolEilMustBeObject"),
      produces: t("automationPage.toolEilInvalidProduces"),
      requiresFacts: t("automationPage.toolEilInvalidRequires"),
      capabilities: t("automationPage.toolEilInvalidCapabilities"),
      factPaths: t("automationPage.toolEilInvalidFactPaths"),
    };
    return map[parsed.error] ?? t("automationPage.toolEilInvalidJson");
  })();

  const factOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of EIL_FACT_CATALOG) {
      map.set(f.key, locale === "pt" ? f.labelPt : f.labelEn);
    }
    for (const key of paramSuggestions) {
      if (!map.has(key)) map.set(key, key);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [locale, paramSuggestions]);

  return (
    <div className="rounded-xl border border-ink-200/80 bg-ink-50/60 p-4 dark:border-ink-700 dark:bg-ink-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{t("automationPage.toolEilTitle")}</p>
            <EilHelpHint label={t("automationPage.agentEilHelpTitle")} title={t("automationPage.agentEilHelpTitle")} sections={helpSections} />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">{t("automationPage.toolEilHelp")}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
          {t("automationPage.toolEilEnable")}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runAutoConfig}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("automationPage.toolEilAutoConfig")}
        </button>
        <p className="text-[10px] text-ink-500">{t("automationPage.toolEilAutoConfigHelp")}</p>
      </div>
      {autoConfigNote ? (
        <p className="mt-2 text-[11px] text-emerald-800 dark:text-emerald-200">{autoConfigNote}</p>
      ) : null}

      {enabled ? (
        <>
          <div className="mt-4 flex gap-1 border-b border-ink-200 dark:border-ink-700">
            <button
              type="button"
              onClick={() => setTab("visual")}
              className={clsx(
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold",
                tab === "visual" ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500",
              )}
            >
              <Database className="h-3.5 w-3.5" />
              {t("automationPage.toolEilTabVisual")}
            </button>
            <button
              type="button"
              onClick={() => setTab("json")}
              className={clsx(
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold",
                tab === "json" ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500",
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              {t("automationPage.agentEilTabJson")}
            </button>
          </div>

          {tab === "visual" ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolEilFieldProduces")}
                </span>
                <textarea
                  rows={3}
                  value={(draft.produces ?? []).join("\n")}
                  onChange={(e) => syncDraft({ ...draft, produces: parseLines(e.target.value) })}
                  placeholder={t("automationPage.toolEilFieldProducesHint")}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
                />
                <p className="mt-1 text-[10px] text-ink-500">{t("automationPage.toolEilFieldProducesHelp")}</p>
                {paramSuggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {paramSuggestions.map((key) => (
                      <button
                        key={`prod-${key}`}
                        type="button"
                        onClick={() => {
                          const produces = unionLineList(draft.produces, key);
                          syncDraft({ ...draft, produces });
                        }}
                        className="rounded-full border border-ink-200 px-2 py-0.5 text-[10px] text-ink-600 hover:border-brand-400 dark:border-ink-600"
                      >
                        + {key}
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>

              <label className="block">
                <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolEilFieldRequiresFacts")}
                </span>
                <textarea
                  rows={2}
                  value={(draft.requiresFacts ?? []).join("\n")}
                  onChange={(e) => syncDraft({ ...draft, requiresFacts: parseLines(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
                />
                {paramSuggestions.length > 0 ? (
                  <p className="mt-1 text-[10px] text-ink-500">{t("automationPage.toolEilParamSuggestionsHint")}</p>
                ) : null}
              </label>

              <label className="block">
                <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolEilFieldCapabilities")}
                </span>
                <textarea
                  rows={2}
                  value={(draft.capabilities ?? []).join("\n")}
                  onChange={(e) => syncDraft({ ...draft, capabilities: parseLines(e.target.value) })}
                  placeholder="lookup_reservation"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
                />
              </label>

              <div>
                <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolEilFieldFactPaths")}
                </span>
                <div className="mt-2 space-y-2">
                  {Object.entries(draft.factPaths ?? {}).map(([fact, path]) => (
                    <div key={fact} className="flex gap-2">
                      <select
                        value={fact}
                        onChange={(e) => {
                          const paths = { ...(draft.factPaths ?? {}) };
                          delete paths[fact];
                          paths[e.target.value] = path;
                          syncDraft({ ...draft, factPaths: paths });
                        }}
                        className="w-2/5 rounded border px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-950"
                      >
                        {factOptions.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                        {!factOptions.some((f) => f.key === fact) ? <option value={fact}>{fact}</option> : null}
                      </select>
                      <input
                        value={path}
                        onChange={(e) =>
                          syncDraft({ ...draft, factPaths: { ...(draft.factPaths ?? {}), [fact]: e.target.value } })
                        }
                        className="flex-1 rounded border px-2 py-1 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const paths = { ...(draft.factPaths ?? {}) };
                          delete paths[fact];
                          syncDraft({ ...draft, factPaths: paths });
                        }}
                        className="text-[10px] text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const key = factOptions[0]?.key ?? "newFact";
                      syncDraft({ ...draft, factPaths: { ...(draft.factPaths ?? {}), [key]: "" } });
                    }}
                    className="text-[11px] font-semibold text-brand-600"
                  >
                    + {t("automationPage.toolEilAddFactPath")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <textarea
                value={json}
                onChange={(e) => onJsonChange(e.target.value)}
                rows={12}
                spellCheck={false}
                className="w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
              />
            </div>
          )}

          {validationMessage ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{validationMessage}</span>
            </div>
          ) : parsed?.ok ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("automationPage.toolEilValid")}
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                <li>
                  {t("automationPage.toolEilSummaryProduces")}: {parsed.summary.produces}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryCapabilities")}: {parsed.summary.capabilities}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryRequires")}: {parsed.summary.requiresFacts}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryFactPaths")}: {parsed.summary.factPaths}
                </li>
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
