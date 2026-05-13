import { format } from "date-fns";
import type { Locale } from "date-fns";
import { next7Days, ymdLocal } from "./reminderUtils";
import { ReminderCard, type ReminderCardModel } from "./ReminderCard";

export function RemindersAgenda(props: {
  reminders: ReminderCardModel[];
  dateLocale: Locale;
  onOpen: (r: ReminderCardModel) => void;
  onToggleComplete: (r: ReminderCardModel) => void;
  onAi: (r: ReminderCardModel) => void;
}) {
  const { reminders, dateLocale, onOpen, onToggleComplete, onAi } = props;
  const days = next7Days();
  const byDay = new Map<string, ReminderCardModel[]>();
  for (const r of reminders) {
    const k = ymdLocal(new Date(r.dueAt));
    const list = byDay.get(k) ?? [];
    list.push(r);
    byDay.set(k, list);
  }

  return (
    <div className="space-y-4">
      {days.map((d) => {
        const k = ymdLocal(d);
        const list = (byDay.get(k) ?? []).slice().sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
        return (
          <div key={k} className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-ink-900 dark:text-ink-50">{format(d, "EEEE, PPP", { locale: dateLocale })}</div>
              <div className="rounded-full bg-ink-50 px-2 py-0.5 text-xs font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
                {list.length}
              </div>
            </div>
            {list.length === 0 ? (
              <div className="mt-3 text-sm text-ink-500 dark:text-ink-400">Sem tarefas para este dia.</div>
            ) : (
              <div className="mt-3 space-y-3">
                {list.map((r) => (
                  <ReminderCard
                    key={r.id}
                    reminder={r}
                    dateLocale={dateLocale}
                    onOpen={() => onOpen(r)}
                    onToggleComplete={() => onToggleComplete(r)}
                    onAi={() => onAi(r)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

