import { useState } from "react";
import clsx from "clsx";
import { SmilePlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { REACTION_QUICK_EMOJIS } from "@/lib/emojiPickerData";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handlePick = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onToggleReaction(messageId, emoji);
      setPickerOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={clsx(
        "relative mt-0.5 flex flex-col gap-1",
        inbound ? "items-start" : "items-end",
      )}
    >
      {reactions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
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
        </div>
      ) : null}

      {canReact ? (
        <div className={clsx("relative flex", inbound ? "justify-start" : "justify-end")}>
          <button
            type="button"
            title={t("conversationDetail.reactToMessage")}
            disabled={busy}
            onClick={() => setPickerOpen((open) => !open)}
            className={clsx(
              "rounded-lg p-1 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800",
              pickerOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
          {pickerOpen ? (
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
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
