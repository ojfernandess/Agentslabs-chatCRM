import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, PlusCircle } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { computeAiScore } from "./reminderUtils";

type ContactOption = {
  id: string;
  name: string;
  phone: string;
};

export type PlannerSuggestion = {
  note: string;
  dueAt: string;
  score: number;
  reasons: string[];
};

export function AiPlannerDrawer(props: {
  open: boolean;
  initialContactId?: string;
  initialGoal?: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { open, initialContactId, initialGoal, onClose, onApplied } = props;
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<PlannerSuggestion[]>([]);

  useEffect(() => {
    if (!open) return;
    setContactId(initialContactId ?? "");
    setGoal(initialGoal ?? "");
    setError("");
    setSuggestions([]);
  }, [open, initialContactId, initialGoal]);

  useEffect(() => {
    if (!open) return;
    setLoadingContacts(true);
    setError("");
    api
      .get<{ data: ContactOption[] }>("/contacts?pageSize=100")
      .then((r) => setContacts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [open]);

  const canGenerate = contactId && goal.trim().length >= 3 && !generating;

  const localFallback = useMemo(() => {
    if (!goal.trim()) return [] as PlannerSuggestion[];
    const now = new Date();
    const mk = (hoursFromNow: number, suffix: string, reasons: string[]) => {
      const due = new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000);
      return {
        note: `${goal.trim()} — ${suffix}`,
        dueAt: due.toISOString(),
        score: computeAiScore(due, false),
        reasons,
      };
    };
    return [
      mk(2, "primeiro contato", ["Recomendado agir hoje", "Reduz risco de esquecimento"]),
      mk(26, "follow-up", ["Sem resposta é comum em 24h", "Mantém ritmo do atendimento"]),
      mk(74, "último lembrete", ["Evita perder timing", "Aumenta chance de conversão"]),
    ];
  }, [goal]);

  const generate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError("");
    try {
      const res = await api.post<{ suggestions: PlannerSuggestion[] }>("/reminders/planner", {
        contactId,
        goal: goal.trim(),
      });
      setSuggestions(Array.isArray(res.suggestions) ? res.suggestions : localFallback);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Não foi possível gerar o plano.";
      setError(msg);
      setSuggestions(localFallback);
    } finally {
      setGenerating(false);
    }
  };

  const apply = async () => {
    if (!contactId || suggestions.length === 0) return;
    setApplying(true);
    setError("");
    try {
      for (const s of suggestions) {
        await api.post("/reminders", { contactId, note: s.note, dueAt: s.dueAt });
      }
      onApplied();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Não foi possível aplicar o plano.";
      setError(msg);
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/35" onClick={onClose} aria-label="Fechar" />
      <aside className="absolute right-0 top-0 flex h-full w-[520px] max-w-[95vw] flex-col border-l border-ink-200 bg-white shadow-xl dark:border-ink-800 dark:bg-ink-950">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">✨ IA Planner</div>
            <div className="mt-0.5 text-base font-bold text-ink-900 dark:text-ink-50">Planejar follow-ups</div>
          </div>
          <button type="button" className="btn-ghost h-11 w-11" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="space-y-4">
            <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
              <label className="text-sm font-semibold text-ink-900 dark:text-ink-50">Contato</label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="input-field mt-2"
                disabled={loadingContacts}
              >
                <option value="">Selecione um contato…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
              <div className="mt-3">
                <label className="text-sm font-semibold text-ink-900 dark:text-ink-50">Objetivo</label>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={3}
                  className="input-field mt-2"
                  placeholder="Ex.: Retornar cliente sobre proposta e agendar reunião"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary min-h-11 px-3 py-2 text-xs" onClick={() => void generate()} disabled={!canGenerate}>
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-4 w-4" />
                    {generating ? "A gerar…" : "Gerar plano"}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-11 px-3 py-2 text-xs"
                  onClick={() => setSuggestions(localFallback)}
                  disabled={!goal.trim()}
                >
                  Usar sugestões rápidas
                </button>
              </div>
              {error ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
              <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">Sugestões</div>
              {suggestions.length === 0 ? (
                <div className="mt-2 text-sm text-ink-500 dark:text-ink-400">Gere um plano para ver sugestões aqui.</div>
              ) : (
                <div className="mt-3 space-y-3">
                  {suggestions.map((s) => (
                    <div key={`${s.dueAt}-${s.note}`} className="rounded-xl border border-ink-100 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-950">
                      <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">{s.note}</div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600 dark:text-ink-300">
                        <span>{new Date(s.dueAt).toLocaleString()}</span>
                        <span className={clsx("rounded-full px-2 py-0.5 font-semibold", s.score >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : s.score >= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-ink-200/60 text-ink-700 dark:bg-ink-900/40 dark:text-ink-200")}>
                          {s.score}%
                        </span>
                      </div>
                      {s.reasons.length > 0 ? (
                        <div className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                          {s.reasons.join(" • ")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-5 py-4 dark:border-ink-800">
          <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-xs" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="btn-primary min-h-11 px-3 py-2 text-xs"
            onClick={() => void apply()}
            disabled={!contactId || suggestions.length === 0 || applying}
          >
            <span className="inline-flex items-center gap-1">
              <PlusCircle className="h-4 w-4" />
              {applying ? "A aplicar…" : "Aplicar plano"}
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}

