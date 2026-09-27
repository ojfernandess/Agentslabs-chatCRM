import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Plus, SmilePlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { REACTION_QUICK_EMOJIS, type EmojiCategoryId } from "@/lib/emojiPickerData";
import { EmojiPickerPopover } from "@/components/EmojiPickerPopover";
import type { ConversationMessageReaction } from "@/lib/conversationMessageReactions";

type Props = {
  messageId: string;
  reactions: ConversationMessageReaction[];
  inbound: boolean;
  canReact: boolean;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
};

export function ConversationMessageReactions({
  messageId,
  reactions,
  inbound,
  canReact,
  onToggleReaction,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!quickPickerOpen && !fullPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(node)) {
        setQuickPickerOpen(false);
        setFullPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [quickPickerOpen, fullPickerOpen]);

  const closePickers = () => {
    setQuickPickerOpen(false);
    setFullPickerOpen(false);
  };

  const handlePick = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onToggleReaction(messageId, emoji);
      closePickers();
    } finally {
      setBusy(false);
    }
  };

  const emojiCategoryLabel = (id: EmojiCategoryId) => t(`common.emojiCategory.${id}`);

  const openFullPicker = () => {
    setQuickPickerOpen(false);
    setFullPickerOpen(true);
  };

  const plusButtonClass = clsx(
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-500 transition hover:bg-brand-500/10 dark:text-brand-400",
    fullPickerOpen && "bg-brand-500/15",
  );

  return (
    <div
      ref={rootRef}
      className={clsx(
        "relative mt-0.5 flex flex-col gap-1",
        inbound ? "items-start" : "items-end",
      )}
    >
      {fullPickerOpen ? (
        <EmojiPickerPopover
          open
          onSelect={(em) => void handlePick(em)}
          categoryLabel={emojiCategoryLabel}
          className={clsx("z-30", inbound ? "left-0" : "right-0 left-auto")}
        />
      ) : null}

      {reactions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              title={r.users.map((u) => u.name).join(", ")}
              disabled={!canReact || busy}
              onClick={() => void handlePick(r.emoji)}
              className={clsx(
                "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition",
                r.reactedByMe
                  ? "border-brand-400 bg-brand-500/15 font-semibold"
                  : "border-ink-200 bg-white/90 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900",
                (!canReact || busy) && "cursor-default opacity-80",
              )}
            >
              <span>{r.emoji}</span>
              {r.count > 1 ? (
                <span className="tabular-nums text-ink-600 dark:text-ink-300">{r.count}</span>
              ) : null}
            </button>
          ))}
          {canReact ? (
            <button
              type="button"
              title={t("conversationDetail.reactMoreEmojis")}
              disabled={busy}
              onClick={openFullPicker}
              className={clsx(
                "inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-400 bg-brand-500/10 text-brand-500 transition hover:bg-brand-500/20 dark:border-brand-400/70 dark:text-brand-400",
                fullPickerOpen && "bg-brand-500/20",
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {canReact ? (
        <div className={clsx("relative flex", inbound ? "justify-start" : "justify-end")}>
          <button
            type="button"
            title={t("conversationDetail.reactToMessage")}
            disabled={busy}
            onClick={() => {
              setFullPickerOpen(false);
              setQuickPickerOpen((open) => !open);
            }}
            className={clsx(
              "rounded-lg p-1 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800",
              quickPickerOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
          {quickPickerOpen ? (
            <div
              className={clsx(
                "absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-xl border border-ink-200 bg-white p-1 shadow-lg dark:border-ink-700 dark:bg-ink-900",
                inbound ? "left-0" : "right-0",
              )}
            >
              {REACTION_QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  disabled={busy}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
                  onClick={() => void handlePick(em)}
                >
                  {em}
                </button>
              ))}
              <button
                type="button"
                title={t("conversationDetail.reactMoreEmojis")}
                disabled={busy}
                onClick={openFullPicker}
                className={plusButtonClass}
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
