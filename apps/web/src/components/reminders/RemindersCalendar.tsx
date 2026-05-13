import { useMemo } from "react";
import { addMonths, format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isToday } from "date-fns";
import type { Locale } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { ymdLocal } from "./reminderUtils";

export type CalendarReminder = {
  id: string;
  dueAt: string;
  completed: boolean;
};

export function RemindersCalendar(props: {
  month: Date;
  dateLocale: Locale;
  reminders: CalendarReminder[];
  selectedDay: Date | null;
  onChangeMonth: (month: Date) => void;
  onSelectDay: (day: Date) => void;
}) {
  const { month, dateLocale, reminders, selectedDay, onChangeMonth, onSelectDay } = props;

  const counts = useMemo(() => {
    const map = new Map<string, { total: number; open: number }>();
    for (const r of reminders) {
      const k = ymdLocal(new Date(r.dueAt));
      const x = map.get(k) ?? { total: 0, open: 0 };
      x.total += 1;
      if (!r.completed) x.open += 1;
      map.set(k, x);
    }
    return map;
  }, [reminders]);

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    days.push(d);
  }

  const dow = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i));

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-base font-bold text-ink-900 dark:text-ink-50">{format(month, "LLLL yyyy", { locale: dateLocale })}</div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost h-11 w-11" onClick={() => onChangeMonth(addMonths(month, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" className="btn-ghost h-11 w-11" onClick={() => onChangeMonth(addMonths(month, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-2">
        {dow.map((d) => (
          <div key={d.toISOString()} className="px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
            {format(d, "EEEEE", { locale: dateLocale })}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-2">
        {days.map((d) => {
          const k = ymdLocal(d);
          const c = counts.get(k);
          const inMonth = isSameMonth(d, month);
          const isSel = selectedDay ? ymdLocal(selectedDay) === k : false;
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onSelectDay(d)}
              className={clsx(
                "min-h-20 rounded-xl border px-2 py-2 text-left transition-colors",
                inMonth ? "border-ink-200 bg-white hover:bg-ink-50 dark:border-ink-800 dark:bg-ink-950 dark:hover:bg-ink-900" : "border-transparent bg-ink-50/40 text-ink-400 dark:bg-ink-900/20 dark:text-ink-600",
                isSel && "ring-2 ring-brand-500/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={clsx("text-xs font-semibold", isToday(d) && inMonth ? "text-brand-700 dark:text-brand-300" : "text-ink-700 dark:text-ink-200")}>
                  {format(d, "d", { locale: dateLocale })}
                </div>
                {c ? (
                  <div className="rounded-full bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
                    {c.open}/{c.total}
                  </div>
                ) : null}
              </div>
              {c ? (
                <div className="mt-2 space-y-1">
                  <div className={clsx("h-1.5 w-full rounded-full", c.open > 0 ? "bg-brand-500/70" : "bg-emerald-500/60")} />
                  <div className="text-[11px] text-ink-500 dark:text-ink-400">{c.open > 0 ? "A fazer" : "Concluído"}</div>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-ink-400 dark:text-ink-500">—</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

