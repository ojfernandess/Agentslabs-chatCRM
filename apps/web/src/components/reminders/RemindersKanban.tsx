import type { Locale } from "date-fns";
import { computeReminderLane } from "./reminderUtils";
import { ReminderCard, type ReminderCardModel } from "./ReminderCard";

export function RemindersKanban(props: {
  reminders: ReminderCardModel[];
  dateLocale: Locale;
  onOpen: (r: ReminderCardModel) => void;
  onToggleComplete: (r: ReminderCardModel) => void;
  onAi: (r: ReminderCardModel) => void;
}) {
  const { reminders, dateLocale, onOpen, onToggleComplete, onAi } = props;
  const lanes = {
    overdue: reminders.filter((r) => computeReminderLane(new Date(r.dueAt), r.completed) === "overdue"),
    today: reminders.filter((r) => computeReminderLane(new Date(r.dueAt), r.completed) === "today"),
    upcoming: reminders.filter((r) => computeReminderLane(new Date(r.dueAt), r.completed) === "upcoming"),
    done: reminders.filter((r) => computeReminderLane(new Date(r.dueAt), r.completed) === "done"),
  };

  const cols: { key: keyof typeof lanes; title: string }[] = [
    { key: "overdue", title: "Atrasados" },
    { key: "today", title: "Hoje" },
    { key: "upcoming", title: "Próximos" },
    { key: "done", title: "Concluídos" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      {cols.map((c) => (
        <div key={c.key} className="rounded-2xl border border-ink-200 bg-white/60 p-3 dark:border-ink-800 dark:bg-ink-900/20">
          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="text-sm font-bold text-ink-900 dark:text-ink-50">{c.title}</div>
            <div className="rounded-full bg-ink-50 px-2 py-0.5 text-xs font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
              {lanes[c.key].length}
            </div>
          </div>
          <div className="space-y-3">
            {lanes[c.key].map((r) => (
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
        </div>
      ))}
    </div>
  );
}

