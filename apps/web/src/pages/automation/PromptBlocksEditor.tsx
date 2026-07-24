import { useEffect, useState, type RefObject } from "react";
import clsx from "clsx";
import { ChevronDown, FileText, Sparkles, Wand2 } from "lucide-react";
import {
  PROMPT_BLOCK_KEYS,
  blocksToPromptUserCore,
  buildAgentPlaybookFromBlocks,
  buildAgentUserCoreForPersist,
  countFilledPromptBlocks,
  emptyPromptBlocks,
  improvePromptFromMarkdown,
  mergeImportedPromptIntoBlocks,
  type PromptBlockKey,
  type PromptBlocks,
  promptBlockHintKey,
  promptBlockLabelKey,
} from "./promptBlocks";

export type PromptBlocksEditorChange = {
  blocks: PromptBlocks;
  fullPrompt: string;
  /** true = o texto completo é a fonte de verdade (como antes dos blocos). */
  useFullPrompt: boolean;
};

export function PromptBlocksEditor({
  blocks,
  fullPrompt,
  useFullPrompt,
  onChange,
  t,
  enableImportImprove = true,
  fullPromptTextareaRef,
}: {
  blocks: PromptBlocks;
  fullPrompt: string;
  useFullPrompt: boolean;
  onChange: (next: PromptBlocksEditorChange) => void;
  t: (key: string) => string;
  enableImportImprove?: boolean;
  /** Ref opcional para fallbacks / seleção de texto no prompt completo. */
  fullPromptTextareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [fullOpen, setFullOpen] = useState(useFullPrompt);
  const [autofillBlocks, setAutofillBlocks] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (useFullPrompt) setFullOpen(true);
  }, [useFullPrompt]);

  const emit = (next: PromptBlocksEditorChange) => {
    onChange(next);
  };

  const onFullPromptLiveChange = (text: string) => {
    if (autofillBlocks) {
      const nextBlocks = mergeImportedPromptIntoBlocks(emptyPromptBlocks(), text, "replace");
      emit({
        blocks: nextBlocks,
        fullPrompt: text,
        useFullPrompt: true,
      });
    } else {
      emit({
        blocks: emptyPromptBlocks(),
        fullPrompt: text,
        useFullPrompt: true,
      });
    }
  };

  const applyAutofillNow = () => {
    const raw = fullPrompt.trim();
    if (!raw) {
      setStatusMsg(t("automationPage.promptImportEmpty"));
      return;
    }
    const nextBlocks = mergeImportedPromptIntoBlocks(emptyPromptBlocks(), raw, "replace");
    emit({
      blocks: nextBlocks,
      fullPrompt: raw,
      useFullPrompt: true,
    });
    setStatusMsg(
      t("automationPage.promptImportApplied").replace(
        "{count}",
        String(countFilledPromptBlocks(nextBlocks)),
      ),
    );
  };

  const applyImprove = () => {
    const source = (
      useFullPrompt
        ? fullPrompt
        : buildAgentPlaybookFromBlocks(blocks) || blocksToPromptUserCore(blocks) || fullPrompt
    ).trim();
    if (!source) {
      setStatusMsg(t("automationPage.promptImproveEmpty"));
      return;
    }
    const { blocks: next, structuredMarkdown, filledCount } = improvePromptFromMarkdown(source);
    if (filledCount === 0) {
      setStatusMsg(t("automationPage.promptImproveNoStructure"));
      return;
    }
    emit({
      blocks: next,
      fullPrompt: structuredMarkdown || source,
      useFullPrompt: false,
    });
    setFullOpen(false);
    setStatusMsg(t("automationPage.promptImproveApplied").replace("{count}", String(filledCount)));
  };

  const openFullPrompt = () => {
    setFullOpen(true);
    setStatusMsg(null);
    const seed =
      fullPrompt.trim() || buildAgentPlaybookFromBlocks(blocks) || blocksToPromptUserCore(blocks);
    emit({
      blocks: emptyPromptBlocks(),
      fullPrompt: seed,
      useFullPrompt: true,
    });
  };

  const closeFullPromptKeepText = () => {
    setFullOpen(false);
    // Mantém o texto completo como fonte; blocos vazios para não sobrescrever ao gravar.
    emit({
      blocks: emptyPromptBlocks(),
      fullPrompt,
      useFullPrompt: true,
    });
  };

  const switchToBlocksOnly = () => {
    setFullOpen(false);
    const core =
      buildAgentPlaybookFromBlocks(blocks) || blocksToPromptUserCore(blocks) || fullPrompt;
    emit({
      blocks: countFilledPromptBlocks(blocks) > 0 ? blocks : emptyPromptBlocks(),
      fullPrompt: core,
      useFullPrompt: false,
    });
  };

  return (
    <div className="space-y-3">
      {enableImportImprove ? (
        <div className="space-y-2 rounded-xl border border-ink-200/80 bg-ink-50/60 p-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (fullOpen) closeFullPromptKeepText();
                else openFullPrompt();
              }}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition",
                fullOpen || useFullPrompt
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

          {fullOpen || useFullPrompt ? (
            <div className="space-y-2 rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-ink-950/80">
              <p className="text-[11px] text-ink-600 dark:text-ink-400">{t("automationPage.promptIncludeFullHelp")}</p>
              <textarea
                ref={fullPromptTextareaRef}
                value={fullPrompt}
                onChange={(e) => onFullPromptLiveChange(e.target.value)}
                rows={12}
                spellCheck={false}
                placeholder={t("automationPage.promptIncludeFullPh")}
                className={clsx(
                  "w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-[11px] leading-relaxed",
                  "dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100",
                )}
              />
              <label className="flex cursor-pointer items-start gap-2 text-[11px] text-ink-600 dark:text-ink-400">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-ink-300"
                  checked={autofillBlocks}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAutofillBlocks(on);
                    if (on && fullPrompt.trim()) {
                      const nextBlocks = mergeImportedPromptIntoBlocks(
                        emptyPromptBlocks(),
                        fullPrompt,
                        "replace",
                      );
                      emit({
                        blocks: nextBlocks,
                        fullPrompt,
                        useFullPrompt: true,
                      });
                    } else if (!on) {
                      emit({
                        blocks: emptyPromptBlocks(),
                        fullPrompt,
                        useFullPrompt: true,
                      });
                    }
                  }}
                />
                <span>{t("automationPage.promptAutofillBlocksOptional")}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {autofillBlocks ? (
                  <button
                    type="button"
                    onClick={applyAutofillNow}
                    className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-100"
                  >
                    {t("automationPage.promptAutofillBlocksNow")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={switchToBlocksOnly}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 dark:border-ink-600 dark:text-ink-200"
                >
                  {t("automationPage.promptUseBlocksEditor")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!(fullOpen || useFullPrompt) || autofillBlocks || countFilledPromptBlocks(blocks) > 0 ? (
        <div
          className={clsx(
            "space-y-2",
            (fullOpen || useFullPrompt) && !autofillBlocks ? "opacity-60" : null,
          )}
        >
          {(fullOpen || useFullPrompt) && !autofillBlocks ? (
            <p className="text-[10px] text-ink-500">{t("automationPage.promptBlocksOptionalWhileFull")}</p>
          ) : null}
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
                  onChange={(e) => {
                    const nextBlocks = { ...blocks, [key]: e.target.value };
                    emit({
                      blocks: nextBlocks,
                      fullPrompt: useFullPrompt
                        ? fullPrompt
                        : buildAgentUserCoreForPersist({
                            useFullPrompt: false,
                            blocks: nextBlocks,
                            fullPrompt,
                          }),
                      useFullPrompt,
                    });
                  }}
                  rows={key === "examples" || key === "flows" ? 4 : 3}
                  disabled={useFullPrompt && !autofillBlocks}
                  className={clsx(
                    "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm leading-relaxed",
                    "dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100",
                    useFullPrompt && !autofillBlocks ? "cursor-not-allowed opacity-70" : null,
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
      ) : null}
    </div>
  );
}

export type { PromptBlockKey, PromptBlocks };
