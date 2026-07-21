import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  PROMPT_BLOCK_KEYS,
  type PromptBlockKey,
  type PromptBlocks,
  promptBlockHintKey,
  promptBlockLabelKey,
} from "./promptBlocks";

export function PromptBlocksEditor({
  blocks,
  onChange,
  t,
}: {
  blocks: PromptBlocks;
  onChange: (next: PromptBlocks) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-2">
      {PROMPT_BLOCK_KEYS.map((key, index) => (
        <details
          key={key}
          open={index < 2}
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
  );
}

export type { PromptBlockKey, PromptBlocks };
