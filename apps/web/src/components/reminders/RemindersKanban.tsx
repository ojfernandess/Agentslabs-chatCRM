import * as React from "react";
import type { Locale } from "date-fns";
import clsx from "clsx";
import { statusFromLegacy, type ReminderStatus } from "./reminderUtils";
import { ReminderCard, type ReminderCardModel } from "./ReminderCard";

export function RemindersKanban(props: {
  reminders: ReminderCardModel[];
  dateLocale: Locale;
  onOpen: (r: ReminderCardModel) => void;
  onToggleComplete: (r: ReminderCardModel) => void;
  onAi: (r: ReminderCardModel) => void;
  onMoveStatus: (id: string, status: ReminderStatus) => void;
}) {
  const { reminders, dateLocale, onOpen, onToggleComplete, onAi, onMoveStatus } = props;
  const lanes: Record<ReminderStatus, ReminderCardModel[]> = {
    TODO: [],
    DOING: [],
    DONE: [],
  };
  for (const r of reminders) {
    const st = statusFromLegacy(r.completed, r.status);
    lanes[st].push(r);
  }

  const cols: { key: ReminderStatus; title: string; hint: string }[] = [
    { key: "TODO", title: "A fazer", hint: "Tudo que precisa acontecer" },
    { key: "DOING", title: "Em progresso", hint: "Follow-ups em andamento" },
    { key: "DONE", title: "Concluído", hint: "Finalizados" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {cols.map((c) => (
        <KanbanColumn
          key={c.key}
          title={c.title}
          hint={c.hint}
          count={lanes[c.key].length}
          onDropId={(id) => onMoveStatus(id, c.key)}
        >
          <div className="space-y-3">
            {lanes[c.key].map((r) => (
              <div key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}>
                <ReminderCard
                  reminder={r}
                  dateLocale={dateLocale}
                  onOpen={() => onOpen(r)}
                  onToggleComplete={() => onToggleComplete(r)}
                  onAi={() => onAi(r)}
                />
              </div>
            ))}
          </div>
        </KanbanColumn>
      ))}
    </div>
  );
}

function KanbanColumn(props: {
  title: string;
  hint: string;
  count: number;
  onDropId: (id: string) => void;
  children: React.ReactNode;
}) {
  const { title, hint, count, onDropId, children } = props;
  const [over, setOver] = React.useState(false);
  return (
    <div
      className={clsx(
        "rounded-2xl border p-3 transition-colors",
        over
          ? "border-brand-400 bg-brand-50/60 dark:border-brand-500/60 dark:bg-brand-950/30"
          : "border-ink-200 bg-white/60 dark:border-ink-800 dark:bg-ink-900/20",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropId(id);
      }}
    >
      <div className="flex items-start justify-between gap-2 pb-2">
        <div>
          <div className="text-sm font-bold text-ink-900 dark:text-ink-50">{title}</div>
          <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{hint}</div>
        </div>
        <div className="rounded-full bg-ink-50 px-2 py-0.5 text-xs font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
          {count}
        </div>
      </div>
      {children}
    </div>
  );
}

