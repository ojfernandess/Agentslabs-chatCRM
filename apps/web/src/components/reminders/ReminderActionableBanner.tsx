import { Link } from "react-router-dom";
import clsx from "clsx";
import { format } from "date-fns";
import { ArrowUpRight, Bell, Check, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { ActionableReminder } from "@/hooks/useActionableReminders";

function contactLabel(row: ActionableReminder): string {
  return row.contact?.name?.trim() || row.contact?.phone?.trim() || "—";
}

function isOverdue(dueAt: string): boolean {
  const dueMs = new Date(dueAt).getTime();
  return !Number.isNaN(dueMs) && dueMs < Date.now();
}

export function ReminderActionableBanner({
  reminders,
  completingId,
  onComplete,
}: {
  reminders: ActionableReminder[];
  completingId: string | null;
  onComplete: (id: string) => void;
}) {
  const { t, dateLocale } = useI18n();

  if (reminders.length === 0) return null;

  const visible = reminders.slice(0, 4);
  const extra = reminders.length - visible.length;
  const hasOverdue = reminders.some((row) => isOverdue(row.dueAt));

  return (
    <div
      className={clsx(
        "shrink-0 border-b border-ink-200/60 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-ink-950/75 sm:px-5",
        hasOverdue ? "border-l-[3px] border-l-red-500" : "border-l-[3px] border-l-brand-500",
      )}
      role="region"
      aria-label={t("reminders.actionableBannerTitle")}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
              <Bell className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </span>
            <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
              {t("reminders.actionableBannerTitle")}
            </p>
            <span className="shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-600 dark:bg-white/10 dark:text-ink-300">
              {reminders.length}
            </span>
          </div>
          <Link
            to="/reminders"
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t("reminders.actionableViewAll")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        <ul className="divide-y divide-ink-100 dark:divide-white/[0.06]">
          {visible.map((row) => {
            const overdue = isOverdue(row.dueAt);
            const due = new Date(row.dueAt);
            const dueLabel = Number.isNaN(due.getTime())
              ? ""
              : format(due, "dd MMM · HH:mm", { locale: dateLocale });
            const completing = completingId === row.id;

            return (
              <li key={row.id} className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  className={clsx(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    overdue ? "bg-red-500" : "bg-brand-500/70",
                  )}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{row.note}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500 dark:text-ink-400">
                    <span className="truncate">{contactLabel(row)}</span>
                    {dueLabel ? (
                      <>
                        <span className="text-ink-300 dark:text-ink-600" aria-hidden>
                          ·
                        </span>
                        <span className={clsx(overdue && "font-medium text-red-600 dark:text-red-400")}>{dueLabel}</span>
                      </>
                    ) : null}
                    <span
                      className={clsx(
                        "rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                        overdue
                          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          : "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
                      )}
                    >
                      {overdue ? t("reminders.filterOverdue") : t("reminders.filterToday")}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-90 transition-opacity group-hover:opacity-100">
                  <Link
                    to={`/reminders?open=${encodeURIComponent(row.id)}`}
                    className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
                  >
                    {t("reminders.actionableOpen")}
                    <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </Link>
                  <button
                    type="button"
                    disabled={completing}
                    onClick={() => onComplete(row.id)}
                    title={completing ? t("reminders.actionableCompleting") : t("reminders.actionableComplete")}
                    aria-label={completing ? t("reminders.actionableCompleting") : t("reminders.actionableComplete")}
                    className={clsx(
                      "flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:cursor-wait disabled:opacity-60",
                      completing
                        ? "border-brand-400 bg-brand-50 text-brand-600 dark:border-brand-500/50 dark:bg-brand-950/50 dark:text-brand-300"
                        : "border-ink-200 text-ink-400 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 dark:border-ink-600 dark:hover:border-brand-500/60 dark:hover:bg-brand-950/40 dark:hover:text-brand-300",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {extra > 0 ? (
          <p className="mt-2 border-t border-ink-100 pt-2 text-xs text-ink-500 dark:border-white/[0.06] dark:text-ink-400">
            <Link to="/reminders" className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              {t("reminders.actionableMore").replace("{n}", String(extra))}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
