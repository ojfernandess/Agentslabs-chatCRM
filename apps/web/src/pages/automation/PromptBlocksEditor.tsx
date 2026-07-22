import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, FileText, Sparkles, Wand2 } from "lucide-react";
import {
  PROMPT_BLOCK_KEYS,
  blocksToPromptUserCore,
  countFilledPromptBlocks,
  improvePromptFromMarkdown,
  mergeImportedPromptIntoBlocks,
  type PromptBlockKey,
  type PromptBlocks,
  promptBlockHintKey,
  promptBlockLabelKey,
} from "./promptBlocks";

export function PromptBlocksEditor({
  blocks,
  onChange,
  t,
  /** Quando true, mostra «Incluir prompt completo» e «Melhorar desempenho». */
  enableImportImprove = true,
}: {
  blocks: PromptBlocks;
  onChange: (next: PromptBlocks) => void;
  t: (key: string) => string;
  enableImportImprove?: boolean;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const applyImport = () => {
    const raw = importText.trim();
    if (!raw) {
      setStatusMsg(t("automationPage.promptImportEmpty"));
      return;
    }
    const next = mergeImportedPromptIntoBlocks(blocks, raw, importMode);
    onChange(next);
    setStatusMsg(
      t("automationPage.promptImportApplied").replace(
        "{count}",
        String(countFilledPromptBlocks(next)),
      ),
    );
    setImportOpen(false);
  };

  const applyImprove = () => {
    const source = blocksToPromptUserCore(blocks).trim();
    if (!source) {
      setStatusMsg(t("automationPage.promptImproveEmpty"));
      return;
    }
    const { blocks: next, filledCount } = improvePromptFromMarkdown(source);
    if (filledCount === 0) {
      setStatusMsg(t("automationPage.promptImproveNoStructure"));
      return;
    }
    onChange(next);
    setStatusMsg(t("automationPage.promptImproveApplied").replace("{count}", String(filledCount)));
  };

  return (
    <div className="space-y-3">
      {enableImportImprove ? (
        <div className="space-y-2 rounded-xl border border-ink-200/80 bg-ink-50/60 p-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setImportOpen((v) => !v);
                setStatusMsg(null);
              }}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition",
                importOpen
                  ? "border-brand-400 bg-brand-50 text-brand-900 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-100"
                  : "border-ink-200 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100 dark:hover:bg-ink-900",
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("automationPage.promptIncludeFull")}
            </button>
            <button
              type="button"
              onClick={applyImprove}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-900 shadow-sm hover:bg-violet-500/15 dark:border-violet-600 dark:text-violet-100"
            >
              <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("automationPage.promptImprovePerf")}
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-ink-500">{t("automationPage.promptImportImproveHelp")}</p>
          {statusMsg ? (
            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
              {statusMsg}
            </p>
          ) : null}
          {importOpen ? (
            <div className="space-y-2 rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950/80">
              <p className="text-[11px] text-ink-600 dark:text-ink-400">{t("automationPage.promptIncludeFullHelp")}</p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={t("automationPage.promptIncludeFullPh")}
                className={clsx(
                  "w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-[11px] leading-relaxed",
                  "dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100",
                )}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-600 dark:text-ink-400">
                  <input
                    type="radio"
                    name="prompt-import-mode"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                  />
                  {t("automationPage.promptImportModeReplace")}
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-600 dark:text-ink-400">
                  <input
                    type="radio"
                    name="prompt-import-mode"
                    checked={importMode === "merge"}
                    onChange={() => setImportMode("merge")}
                  />
                  {t("automationPage.promptImportModeMerge")}
                </label>
                <button
                  type="button"
                  onClick={applyImport}
                  className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  {t("automationPage.promptImportApply")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        {PROMPT_BLOCK_KEYS.map((key, index) => (
          <details
            key={key}
            open={index < 2 || Boolean(blocks[key]?.trim())}
            className="group rounded-xl border border-ink-200/90 bg-white/90 dark:border-ink-700 dark:bg-ink-950/50"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-ink-900 dark:text-ink-50 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
              <span>{t(promptBlockLabelKey(key))}</span>
              {blocks[key]?.trim() ? (
                <span className="ml-auto rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
                  OK
                </span>
              ) : null}
            </summary>
            <div className="border-t border-ink-100 px-3 pb-3 pt-2 dark:border-ink-800">
              <p className="mb-2 text-[11px] text-ink-500">{t(promptBlockHintKey(key))}</p>
              <textarea
                value={blocks[key]}
                onChange={(e) => onChange({ ...blocks, [key]: e.target.value })}
                rows={key === "examples" || key === "flows" ? 4 : 3}
                className={clsx(
                  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm leading-relaxed",
                  "dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100",
                )}
              />
            </div>
            {index < PROMPT_BLOCK_KEYS.length - 1 ? (
              <div className="flex justify-center py-1 text-ink-300 dark:text-ink-600" aria-hidden>
                ↓
              </div>
            ) : null}
          </details>
        ))}
      </div>
    </div>
  );
}

export type { PromptBlockKey, PromptBlocks };
