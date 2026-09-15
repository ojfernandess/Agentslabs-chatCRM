import { useState } from "react";
import clsx from "clsx";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Props = { articleSlug: string };

export function HelpFeedback({ articleSlug }: Props) {
  const { t } = useI18n();
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  const storageKey = `help_feedback_${articleSlug}`;

  const handleVote = (v: "up" | "down") => {
    setVote(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* ignore */
    }
  };

  const handleSend = () => {
    setSent(true);
    try {
      localStorage.setItem(`${storageKey}_comment`, comment);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="mt-12 rounded-2xl border border-ink-200 bg-ink-50/80 p-6 dark:border-ink-700 dark:bg-ink-900/40">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("help.feedback.title")}</h3>
      {sent ? (
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">{t("help.feedback.thanks")}</p>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => handleVote("up")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                vote === "up"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "border-ink-200 bg-white hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700",
              )}
            >
              <ThumbsUp className="h-4 w-4" />
              {t("help.feedback.yes")}
            </button>
            <button
              type="button"
              onClick={() => handleVote("down")}
              className={clsx(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                vote === "down"
                  ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                  : "border-ink-200 bg-white hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700",
              )}
            >
              <ThumbsDown className="h-4 w-4" />
              {t("help.feedback.no")}
            </button>
          </div>
          {vote === "down" ? (
            <div className="mt-4 space-y-2">
              <label htmlFor="help-feedback-comment" className="text-sm text-ink-600 dark:text-ink-400">
                {t("help.feedback.whatMissing")}
              </label>
              <textarea
                id="help-feedback-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
              />
              <button
                type="button"
                onClick={handleSend}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {t("help.feedback.send")}
              </button>
            </div>
          ) : vote === "up" ? (
            <button
              type="button"
              onClick={handleSend}
              className="mt-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("help.feedback.send")}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
