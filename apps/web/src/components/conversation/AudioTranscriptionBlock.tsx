import { Subtitles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  text: string;
  className?: string;
};

export function AudioTranscriptionBlock({ text, className }: Props) {
  const { t } = useI18n();
  const spoken = text.trim();
  if (!spoken) return null;

  return (
    <div
      className={
        className ??
        "mt-2 overflow-hidden rounded-xl border border-ink-200/80 bg-ink-50/90 dark:border-ink-700/80 dark:bg-ink-900/50"
      }
    >
      <div className="flex items-center gap-2 border-b border-ink-200/60 bg-ink-100/60 px-3 py-2 dark:border-ink-700/60 dark:bg-ink-800/40">
        <Subtitles className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" strokeWidth={2} />
        <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">
          {t("conversationDetail.imageTranscriptionTitle")}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-xs leading-relaxed text-ink-700 [overflow-wrap:anywhere] dark:text-ink-200">
        {spoken}
      </p>
    </div>
  );
}
