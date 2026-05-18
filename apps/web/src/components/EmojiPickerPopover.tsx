import { useState } from "react";
import clsx from "clsx";
import { EMOJI_CATEGORIES, type EmojiCategoryId } from "@/lib/emojiPickerData";

interface Props {
  open: boolean;
  onSelect: (emoji: string) => void;
  categoryLabel: (id: EmojiCategoryId) => string;
  className?: string;
}

export function EmojiPickerPopover({ open, onSelect, categoryLabel, className }: Props) {
  const [category, setCategory] = useState<EmojiCategoryId>("smileys");

  if (!open) return null;

  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];

  return (
    <div
      className={clsx(
        "absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-600 dark:bg-ink-900",
        className,
      )}
    >
      <div className="flex gap-0.5 overflow-x-auto border-b border-ink-100 p-1 dark:border-ink-800">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={clsx(
              "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold",
              category === cat.id
                ? "bg-violet-500/15 text-violet-800 dark:text-violet-200"
                : "text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800",
            )}
          >
            {categoryLabel(cat.id)}
          </button>
        ))}
      </div>
      <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {active.emojis.map((em) => (
          <button
            key={em}
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
            onClick={() => onSelect(em)}
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}

