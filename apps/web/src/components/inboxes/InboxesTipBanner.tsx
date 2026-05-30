import { Lightbulb } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function InboxesTipBanner() {
  const { t } = useI18n();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-200/60 bg-gradient-to-r from-brand-50 via-violet-50/80 to-white p-5 dark:border-brand-900/40 dark:from-brand-950/40 dark:via-violet-950/20 dark:to-ink-950/40 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("inboxesPage.dashboard.tipTitle")}</p>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {t("inboxesPage.dashboard.tipBody")}
            </p>
          </div>
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400 sm:max-w-[200px] sm:text-right">
          {t("inboxesPage.dashboard.tipHint")}
        </p>
      </div>
    </div>
  );
}
