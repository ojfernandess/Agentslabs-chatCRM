import { useRef, useState } from "react";
import clsx from "clsx";
import { Plus, Smile } from "lucide-react";
import { EmojiPickerPopover } from "@/components/EmojiPickerPopover";
import { CANNED_VARIABLE_INSERT_OPTIONS } from "@/lib/cannedResponseVariables";
import { settingsInput, settingsMuted } from "@/components/settings/settingsUi";
import type { EmojiCategoryId } from "@/lib/emojiPickerData";

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  snippet: string,
  onChange: (next: string) => void,
  current: string,
) {
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const next = `${before}${snippet}${after}`;
  onChange(next);
  const pos = start + snippet.length;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
  });
}

export function CannedMessageBuilderField({
  value,
  onChange,
  t,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  t: (key: string) => string;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const insertSnippet = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(value.trim() ? `${value}${snippet}` : snippet);
      return;
    }
    insertAtCursor(el, snippet, onChange, value);
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.cannedMessage")}</label>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative" ref={emojiWrapRef}>
            <button
              type="button"
              className="touch-target-compact btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
              onClick={() => setEmojiOpen((o) => !o)}
              aria-expanded={emojiOpen}
              title={t("settings.cannedInsertEmoji")}
            >
              <Smile className="h-3.5 w-3.5" />
              {t("settings.cannedInsertEmoji")}
            </button>
            <EmojiPickerPopover
              open={emojiOpen}
              onSelect={(em) => {
                insertSnippet(em);
                setEmojiOpen(false);
              }}
              categoryLabel={(id: EmojiCategoryId) => t(`common.emojiCategory.${id}`)}
              className="left-auto right-0"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-3 dark:border-white/10 dark:bg-white/5">
        <p className="mb-2 text-xs font-medium text-ink-600 dark:text-ink-400">{t("settings.cannedVariablesBuilder")}</p>
        <div className="flex flex-wrap gap-1.5">
          {CANNED_VARIABLE_INSERT_OPTIONS.map((opt) => (
            <button
              key={opt.token}
              type="button"
              className="touch-target-compact inline-flex items-center rounded-lg border border-brand-200/80 bg-white px-2 py-1 font-mono text-[11px] font-medium text-brand-800 shadow-sm hover:bg-brand-50 dark:border-brand-800/50 dark:bg-ink-900 dark:text-brand-200 dark:hover:bg-brand-950/40"
              onClick={() => insertSnippet(opt.token)}
              title={opt.token}
            >
              {opt.token}
            </button>
          ))}
          <button
            type="button"
            className="touch-target-compact btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
            onClick={() => insertSnippet(CANNED_VARIABLE_INSERT_OPTIONS[0].token)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.cannedInsertVariable")}
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={placeholder}
        className={clsx(settingsInput, "mt-2 min-h-[120px]")}
        required
      />
      <p className={`mt-1 text-xs ${settingsMuted}`}>{t("settings.cannedVariablesHint")}</p>
    </div>
  );
}
