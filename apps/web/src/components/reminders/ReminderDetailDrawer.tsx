import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { X, Trash2, Check, Clock, Sparkles, MessageSquare } from "lucide-react";
import clsx from "clsx";
import type { Locale } from "date-fns";
import { aiInsightLines, computeAiScore, computePriority, formatShortDue } from "./reminderUtils";

export type ReminderDetailModel = {
  id: string;
  note: string;
  dueAt: string;
  completed: boolean;
  contact: { id: string; name: string; phone: string };
};

export function ReminderDetailDrawer(props: {
  open: boolean;
  reminder: ReminderDetailModel | null;
  dateLocale: Locale;
  onClose: () => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  onSave: (id: string, patch: { note?: string; dueAt?: string }) => Promise<void>;
  onOpenPlanner: (reminder: ReminderDetailModel) => void;
}) {
  const { open, reminder, dateLocale, onClose, onToggleComplete, onDelete, onSave, onOpenPlanner } = props;
  const [saving, setSaving] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");

  useEffect(() => {
    if (!open || !reminder) return;
    setDraftNote(reminder.note);
    const d = new Date(reminder.dueAt);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    setDraftDate(`${yy}-${mm}-${dd}`);
    setDraftTime(`${hh}:${mi}`);
  }, [open, reminder]);

  const snapshot = useMemo(() => {
    if (!reminder) return null;
    const due = new Date(reminder.dueAt);
    const aiScore = computeAiScore(due, reminder.completed);
    const priority = computePriority(due, reminder.completed);
    const insights = aiInsightLines(due, reminder.completed, dateLocale);
    return { due, aiScore, priority, insights };
  }, [reminder, dateLocale]);

  const show = open && reminder && snapshot;

  if (!show) return null;

  const priorityLabel =
    snapshot.priority === "urgent"
      ? "Urgente"
      : snapshot.priority === "high"
        ? "Alta"
        : snapshot.priority === "medium"
          ? "Média"
          : "Baixa";

  const close = () => {
    setDraftNote("");
    setDraftDate("");
    setDraftTime("");
    onClose();
  };

  const save = async () => {
    if (!reminder) return;
    const patch: { note?: string; dueAt?: string } = {};
    const n = draftNote.trim();
    if (n && n !== reminder.note) patch.note = n;
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draftDate.trim());
    const tm = /^(\d{2}):(\d{2})$/.exec(draftTime.trim());
    if (dm && tm) {
      const y = Number(dm[1]);
      const mo = Number(dm[2]);
      const d = Number(dm[3]);
      const h = Number(tm[1]);
      const mi = Number(tm[2]);
      const local = new Date(y, mo - 1, d, h, mi, 0);
      const iso = local.toISOString();
      if (iso !== reminder.dueAt) patch.dueAt = iso;
    }
    if (!patch.note && !patch.dueAt) {
      close();
      return;
    }
    setSaving(true);
    try {
      await onSave(reminder.id, patch);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/35" onClick={close} aria-label="Fechar" />
      <aside className="absolute right-0 top-0 flex h-full w-[520px] max-w-[95vw] flex-col border-l border-ink-200 bg-white shadow-xl dark:border-ink-800 dark:bg-ink-950">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Lembrete</div>
            <div className="mt-0.5 truncate text-base font-bold text-ink-900 dark:text-ink-50">{reminder.note}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatShortDue(snapshot.due, dateLocale)}
              </span>
              <span className="rounded-full bg-ink-50 px-2 py-0.5 font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
                {priorityLabel}
              </span>
            </div>
          </div>
          <button type="button" className="btn-ghost h-11 w-11" onClick={close} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="space-y-4">
            <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
              <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">Contato</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{reminder.contact.name}</div>
                  <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{reminder.contact.phone}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/contacts/${reminder.contact.id}`} className="btn-secondary min-h-11 px-3 py-2 text-xs">
                    Abrir contato
                  </Link>
                  <Link
                    to={`/conversations?q=${encodeURIComponent(reminder.contact.phone || reminder.contact.name)}`}
                    className="btn-ghost min-h-11 px-3 py-2 text-xs"
                    title="Abrir conversas"
                  >
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      Conversas
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">IA Insights</div>
                  <div className="mt-1 text-xs text-ink-500 dark:text-ink-400">Base heurística. Substituível por IA real.</div>
                </div>
                <div className="rounded-full bg-ink-50 px-2 py-1 text-xs font-semibold text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
                  <span className={clsx("inline-flex items-center gap-1", snapshot.aiScore >= 80 ? "text-emerald-700 dark:text-emerald-300" : snapshot.aiScore >= 60 ? "text-amber-700 dark:text-amber-300" : "text-ink-700 dark:text-ink-200")}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {snapshot.aiScore}%
                  </span>
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-ink-800 dark:text-ink-100">
                {snapshot.insights.map((x) => (
                  <li key={x} className="leading-6">
                    {x}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary min-h-11 px-3 py-2 text-xs"
                  onClick={() => onOpenPlanner(reminder)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-4 w-4" />
                    IA Planner
                  </span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-sm font-semibold text-ink-900 dark:text-ink-50">Nota</label>
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    rows={3}
                    className="input-field mt-2"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-ink-900 dark:text-ink-50">Quando</label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="input-field" />
                    <input type="time" value={draftTime} onChange={(e) => setDraftTime(e.target.value)} className="input-field" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-5 py-4 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={clsx(
                "btn-secondary min-h-11 px-3 py-2 text-xs",
                reminder.completed && "bg-ink-50 text-ink-400 dark:bg-ink-900/40 dark:text-ink-500",
              )}
              onClick={() => onToggleComplete(reminder.id, reminder.completed)}
            >
              <span className="inline-flex items-center gap-1">
                <Check className="h-4 w-4" />
                {reminder.completed ? "Reabrir" : "Concluir"}
              </span>
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11 px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
              onClick={() => onDelete(reminder.id)}
            >
              <span className="inline-flex items-center gap-1">
                <Trash2 className="h-4 w-4" />
                Excluir
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-xs" onClick={close}>
              Cancelar
            </button>
            <button type="button" className="btn-primary min-h-11 px-3 py-2 text-xs" onClick={() => void save()} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

