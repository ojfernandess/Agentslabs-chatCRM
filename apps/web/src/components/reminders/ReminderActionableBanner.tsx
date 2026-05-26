import { Link } from "react-router-dom";
import clsx from "clsx";
import { format } from "date-fns";
import { AlertCircle, Bell, Check, Clock, UserCircle } from "lucide-react";
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

  const visible = reminders.slice(0, 5);
  const extra = reminders.length - visible.length;

  return (
    <div
      className="shrink-0 border-b border-amber-300/70 bg-gradient-to-r from-amber-50 via-amber-50/95 to-orange-50/90 px-4 py-3 shadow-sm dark:border-amber-700/40 dark:from-amber-950/50 dark:via-amber-950/40 dark:to-orange-950/30"
      role="region"
      aria-label={t("reminders.actionableBannerTitle")}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-950 dark:text-amber-100">
            <Bell className="h-4 w-4 shrink-0" aria-hidden />
            {t("reminders.actionableBannerTitle")}
            <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-amber-950 dark:bg-amber-900/60 dark:text-amber-100">
              {reminders.length}
            </span>
          </p>
          <Link
            to="/reminders"
            className="text-xs font-semibold text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
          >
            {t("reminders.actionableViewAll")}
          </Link>
        </div>

        <ul className="space-y-2">
          {visible.map((row) => {
            const overdue = isOverdue(row.dueAt);
            const due = new Date(row.dueAt);
            const dueLabel = Number.isNaN(due.getTime())
              ? ""
              : format(due, "dd MMM · HH:mm", { locale: dateLocale });

            return (
              <li
                key={row.id}
                className={clsx(
                  "flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3 py-2.5",
                  overdue
                    ? "border-red-300/80 bg-red-50/90 dark:border-red-800/50 dark:bg-red-950/35"
                    : "border-amber-200/90 bg-white/85 dark:border-amber-800/40 dark:bg-amber-950/25",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{row.note}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600 dark:text-ink-300">
                    <span className="inline-flex items-center gap-1">
                      <UserCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {contactLabel(row)}
                    </span>
                    {dueLabel ? (
                      <span className="inline-flex items-center gap-1">
                        {overdue ? (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-300" aria-hidden />
                        ) : (
                          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        {dueLabel}
                      </span>
                    ) : null}
                    {overdue ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">
                        {t("reminders.filterOverdue")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                        {t("reminders.filterToday")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/reminders?open=${encodeURIComponent(row.id)}`}
                    className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10"
                  >
                    {t("reminders.actionableOpen")}
                  </Link>
                  <button
                    type="button"
                    disabled={completingId === row.id}
                    onClick={() => onComplete(row.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60 dark:bg-brand-600"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {completingId === row.id ? t("reminders.actionableCompleting") : t("reminders.actionableComplete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {extra > 0 ? (
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            {t("reminders.actionableMore").replace("{n}", String(extra))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
