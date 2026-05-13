import { Check, Clock, AlertCircle, Sparkles, MessageSquare, UserCircle } from "lucide-react";
import clsx from "clsx";
import { motion } from "@/components/Motion";
import {
  formatShortDue,
  computeAiScore,
  priorityFromLegacy,
  priorityLabelDb,
  statusFromLegacy,
  type ReminderPriorityDb,
  type ReminderStatus,
} from "./reminderUtils";
import type { Locale } from "date-fns";

export type ReminderCardModel = {
  id: string;
  note: string;
  dueAt: string;
  completed: boolean;
  status?: ReminderStatus;
  priority?: ReminderPriorityDb;
  contact: { id: string; name: string; phone: string };
};

export function ReminderCard(props: {
  reminder: ReminderCardModel;
  dateLocale: Locale;
  onOpen: () => void;
  onToggleComplete: () => void;
  onAi: () => void;
}) {
  const { reminder, dateLocale, onOpen, onToggleComplete, onAi } = props;
  const due = new Date(reminder.dueAt);
  const overdue = !reminder.completed && Date.now() > due.getTime();
  const aiScore = computeAiScore(due, reminder.completed);
  const status = statusFromLegacy(reminder.completed, reminder.status);
  const priority = priorityFromLegacy(reminder.completed, due, reminder.priority);
  const priorityLabel = priorityLabelDb(priority);
  const statusLabel = status === "DONE" ? "Concluído" : status === "DOING" ? "Em progresso" : "A fazer";

  return (
    <div
      className={clsx(
        "rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-ink-900/60",
        overdue ? "border-red-200 dark:border-red-900/50" : "border-ink-200 dark:border-ink-700",
      )}
    >
      <div className="flex items-start gap-3">
        <motion.button
          type="button"
          onClick={onToggleComplete}
          className={clsx(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            reminder.completed
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-ink-300 hover:border-brand-400 dark:border-ink-500",
          )}
          whileTap={{ scale: 0.85 }}
          aria-label={reminder.completed ? "Marcar como pendente" : "Concluir"}
        >
          {reminder.completed ? <Check className="h-3.5 w-3.5" /> : null}
        </motion.button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={clsx(
                  "text-sm font-semibold text-ink-900 dark:text-ink-50",
                  reminder.completed && "text-ink-400 line-through dark:text-ink-500",
                )}
              >
                {reminder.note}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <UserCircle className="h-3.5 w-3.5" />
                  <span className="truncate">{reminder.contact.name}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  {overdue ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : <Clock className="h-3.5 w-3.5" />}
                  {formatShortDue(due, dateLocale)}
                </span>
                <span className={clsx("rounded-full px-2 py-0.5 font-semibold", overdue ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200" : "bg-ink-50 text-ink-700 dark:bg-ink-800 dark:text-ink-200")}>
                  {priorityLabel}
                </span>
                <span className={clsx("rounded-full px-2 py-0.5 font-semibold", status === "DONE" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : status === "DOING" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-ink-50 text-ink-700 dark:bg-ink-800 dark:text-ink-200")}>
                  {statusLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpen}
                className="btn-secondary min-h-11 px-3 py-2 text-xs"
              >
                Abrir
              </button>
              <button
                type="button"
                onClick={onAi}
                className="btn-ghost min-h-11 px-3 py-2 text-xs"
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-4 w-4" />
                  IA
                </span>
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Sparkles className="h-3.5 w-3.5" />
                  IA Score
                </span>
                <span className={clsx("font-semibold", aiScore >= 80 ? "text-emerald-700 dark:text-emerald-300" : aiScore >= 60 ? "text-amber-700 dark:text-amber-300" : "text-ink-600 dark:text-ink-300")}>
                  {aiScore}%
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-ink-500 dark:text-ink-400">
                <MessageSquare className="h-3.5 w-3.5" />
                WhatsApp
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

