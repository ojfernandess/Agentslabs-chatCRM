import { useMemo, useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Bell, Plus, Search, CalendarDays, LayoutGrid, List, Sparkles, Filter, Workflow, X } from "lucide-react";
import clsx from "clsx";
import { startOfMonth, isPast, isToday } from "date-fns";
import {
  PageTransition,
  motion,
  AnimatePresence,
  expandVariants,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { RemindersViewSwitch, type RemindersViewMode } from "@/components/reminders/RemindersViewSwitch";
import { ReminderCard, type ReminderCardModel } from "@/components/reminders/ReminderCard";
import { RemindersKanban } from "@/components/reminders/RemindersKanban";
import { RemindersAgenda } from "@/components/reminders/RemindersAgenda";
import { RemindersCalendar } from "@/components/reminders/RemindersCalendar";
import { ReminderDetailDrawer, type ReminderDetailModel } from "@/components/reminders/ReminderDetailDrawer";
import { AiPlannerDrawer } from "@/components/reminders/AiPlannerDrawer";
import {
  computeAiScore,
  isWithinDateRange,
  priorityFromLegacy,
  statusFromLegacy,
  type ReminderPriorityDb,
  type ReminderStatus,
} from "@/components/reminders/reminderUtils";

interface Reminder {
  id: string;
  note: string;
  dueAt: string;
  completed: boolean;
  status?: ReminderStatus;
  priority?: ReminderPriorityDb;
  contact: { id: string; name: string; phone: string };
}

interface ContactOption {
  id: string;
  name: string;
  phone: string;
}

/** Próximo dia no calendário local como YYYY-MM-DD (sem usar UTC, ao contrário de toISOString). */
function tomorrowLocalYmd(): string {
  const x = new Date();
  x.setDate(x.getDate() + 1);
  const yy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Data (YYYY-MM-DD) + hora do &lt;input type="time"&gt; → ISO UTC.
 * Usa `new Date(y, m, d, h, mi, s)` em horário local para evitar `Invalid Date` com horas
 * sem zero à esquerda (ex. T9:30:00) ou outros formatos que o parse ISO não aceita.
 */
function localDueToIso(dueDate: string, dueTime: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  if (!dm) throw new RangeError("invalid_due_date");
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const t = dueTime.trim();
  let h = 9;
  let mi = 0;
  let s = 0;
  if (t) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (!tm) throw new RangeError("invalid_due_time");
    h = Number(tm[1]);
    mi = Number(tm[2]);
    s = tm[3] != null ? Number(tm[3]) : 0;
  }
  const local = new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(local.getTime())) throw new RangeError("invalid_due_at");
  return local.toISOString();
}

export function RemindersPage() {
  const { t, dateLocale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState("");

  const [viewMode, setViewMode] = useState<RemindersViewMode>(() => {
    try {
      const raw = localStorage.getItem("openconduit_reminders_view") ?? "";
      if (raw === "list" || raw === "kanban" || raw === "agenda" || raw === "calendar") return raw;
      return "list";
    } catch {
      return "list";
    }
  });

  const [statusFilter, setStatusFilter] = useState<"all" | ReminderStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | ReminderPriorityDb>("all");
  const [iaMinScore, setIaMinScore] = useState(0);
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("09:00");
  const [submitting, setSubmitting] = useState(false);
  const [formSaveError, setFormSaveError] = useState("");
  const [contactsBanner, setContactsBanner] = useState<"none" | "error" | "empty">("none");

  const hasAnimated = useRef(false);
  const isFirstRender = useRef(true);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailReminder, setDetailReminder] = useState<ReminderDetailModel | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerInitial, setPlannerInitial] = useState<{ contactId?: string; goal?: string }>({});

  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [calendarDay, setCalendarDay] = useState<Date | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("openconduit_reminders_view", viewMode);
    } catch {
    }
  }, [viewMode]);

  async function fetchReminders(showSpinner: boolean) {
    if (showSpinner) setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("filter", filter);
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      const qs = params.toString();
      const data = await api.get<Reminder[]>(`/reminders${qs ? `?${qs}` : ""}`);
      setReminders(Array.isArray(data) ? data : []);
    } catch {
      setReminders([]);
      setListError(t("reminders.listLoadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const first = !hasAnimated.current;
    if (!hasAnimated.current) hasAnimated.current = true;
    void fetchReminders(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search changes use debounced effect below
  }, [filter, statusFilter, priorityFilter]);

  useEffect(() => {
    const id = searchParams.get("open");
    if (!id) return;
    const r = reminders.find((x) => x.id === id);
    if (!r) return;
    openDetail(r);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, reminders]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => void fetchReminders(false), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter-only loads handled above
  }, [search]);

  const applyFilters = useMemo(() => {
    const start = rangeStart ? new Date(`${rangeStart}T00:00:00`) : undefined;
    const end = rangeEnd ? new Date(`${rangeEnd}T23:59:59`) : undefined;
    const q = search.trim().toLowerCase();
    return (r: Reminder): boolean => {
      const due = new Date(r.dueAt);
      const st = statusFromLegacy(r.completed, r.status);
      const pr = priorityFromLegacy(r.completed, due, r.priority);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      if (priorityFilter !== "all" && pr !== priorityFilter) return false;
      if (iaMinScore > 0) {
        const s = computeAiScore(due, r.completed);
        if (s < iaMinScore) return false;
      }
      if (!isWithinDateRange(due, start, end)) return false;
      if (q) {
        const hay = `${r.note} ${r.contact?.name ?? ""} ${r.contact?.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
  }, [rangeStart, rangeEnd, search, statusFilter, priorityFilter, iaMinScore]);

  const displayReminders: ReminderCardModel[] = useMemo(() => {
    return reminders.filter(applyFilters).map((r) => ({
      id: r.id,
      note: r.note,
      dueAt: r.dueAt,
      completed: r.completed,
      status: r.status,
      priority: r.priority,
      contact: r.contact,
    }));
  }, [reminders, applyFilters]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayOpen = reminders.filter((r) => !r.completed && isToday(new Date(r.dueAt))).length;
    const overdue = reminders.filter((r) => !r.completed && isPast(new Date(r.dueAt)) && !isToday(new Date(r.dueAt))).length;
    const aiPrioritized = reminders.filter((r) => !r.completed && computeAiScore(new Date(r.dueAt), r.completed) >= 75).length;
    const total = reminders.length;
    const done = reminders.filter((r) => r.completed).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    const lostFollowups = reminders.filter((r) => !r.completed && isPast(new Date(r.dueAt))).length;
    const avgTime = "—";
    return { now, todayOpen, overdue, aiPrioritized, completionRate, lostFollowups, avgTime };
  }, [reminders]);

  const openForm = async () => {
    setFormSaveError("");
    setContactsBanner("none");
    try {
      const result = await api.get<{ data: ContactOption[] }>("/contacts?pageSize=100");
      const rows = Array.isArray(result.data) ? result.data : [];
      setContacts(
        rows.map((c) => ({
          id: c.id,
          name: c.name ?? "",
          phone: c.phone ?? "",
        })),
      );
      setContactsBanner(rows.length === 0 ? "empty" : "none");
    } catch {
      setContacts([]);
      setContactsBanner("error");
    }
    setDueDate(tomorrowLocalYmd());
    setDueTime("09:00");
    setNote("");
    setSelectedContactId("");
    setShowForm(true);
  };

  const openDetail = (r: ReminderDetailModel) => {
    setDetailReminder(r);
    setDetailOpen(true);
  };

  const openPlannerFor = (contactId?: string, goal?: string) => {
    setPlannerInitial({ contactId, goal });
    setPlannerOpen(true);
  };

  const handleCreate = async () => {
    const noteTrim = note.trim();
    if (!selectedContactId || !noteTrim || !dueDate) return;
    setSubmitting(true);
    setFormSaveError("");
    try {
      const dueAt = localDueToIso(dueDate, dueTime);
      await api.post("/reminders", {
        contactId: selectedContactId,
        note: noteTrim,
        dueAt,
      });
      setShowForm(false);
      void fetchReminders(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("reminders.createError");
      setFormSaveError(msg || t("reminders.createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleComplete = async (id: string, completed: boolean) => {
    try {
      await api.put(`/reminders/${id}`, { completed: !completed });
      void fetchReminders(false);
    } catch {
      /* ignore */
    }
  };

  const deleteReminder = async (id: string) => {
    try {
      await api.delete(`/reminders/${id}`);
      void fetchReminders(false);
    } catch {
      /* ignore */
    }
  };

  const moveStatus = async (id: string, status: ReminderStatus) => {
    await api.put(`/reminders/${id}`, { status });
    await fetchReminders(false);
  };

  const saveReminder = async (id: string, patch: { note?: string; dueAt?: string; status?: ReminderStatus; priority?: ReminderPriorityDb }) => {
    await api.put(`/reminders/${id}`, patch);
    await fetchReminders(false);
  };

  const filters: { key: string; labelKey: string }[] = [
    { key: "all", labelKey: "reminders.filterAll" },
    { key: "today", labelKey: "reminders.filterToday" },
    { key: "overdue", labelKey: "reminders.filterOverdue" },
    { key: "upcoming", labelKey: "reminders.filterUpcoming" },
  ];

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-ink-50">{t("reminders.title")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-ink-400">{t("reminders.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className="btn-secondary min-h-11 px-3 py-2 text-sm"
            >
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                Calendário
              </span>
            </button>
            <Link to="/automation" className="btn-secondary min-h-11 px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <Workflow className="h-4 w-4" />
                Automação
              </span>
            </Link>
            <button
              type="button"
              onClick={() => openPlannerFor()}
              className="btn-secondary min-h-11 px-3 py-2 text-sm"
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                IA Planner
              </span>
            </button>
            <motion.button
              type="button"
              onClick={() => void openForm()}
              className="btn-primary min-h-11 px-4 py-2 text-sm"
              whileTap={{ scale: 0.97 }}
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t("reminders.newReminder")}
              </span>
            </motion.button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="card-surface rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Hoje</div>
            <div className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{stats.todayOpen}</div>
          </div>
          <div className="card-surface rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Atrasados</div>
            <div className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{stats.overdue}</div>
          </div>
          <div className="card-surface rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">IA prioritários</div>
            <div className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{stats.aiPrioritized}</div>
          </div>
          <div className="card-surface rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Taxa de conclusão</div>
            <div className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{stats.completionRate}%</div>
          </div>
          <div className="card-surface rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Follow-ups perdidos</div>
            <div className="mt-2 text-2xl font-bold text-ink-900 dark:text-ink-50">{stats.lostFollowups}</div>
            <div className="mt-1 text-xs text-ink-500 dark:text-ink-400">Tempo médio: {stats.avgTime}</div>
          </div>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div
              className="mb-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-700 dark:bg-ink-900/60"
              variants={expandVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-ink-50">{t("reminders.formTitle")}</h2>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="btn-ghost h-11 w-11"
                  aria-label={t("reminders.cancel")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {contactsBanner === "error" ? (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {t("reminders.contactsLoadError")}
                </p>
              ) : null}
              {contactsBanner === "empty" ? (
                <p className="mb-3 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:border-ink-600 dark:bg-ink-800/50 dark:text-ink-200">
                  {t("reminders.noContactsHint")}
                </p>
              ) : null}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-200">{t("reminders.contact")}</label>
                  <select
                    value={selectedContactId}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                  >
                    <option value="">{t("reminders.contactPlaceholder")}</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-200">{t("reminders.note")}</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t("reminders.notePlaceholder")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-ink-200">{t("reminders.dueDate")}</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-ink-200">{t("reminders.dueTime")}</label>
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                    />
                  </div>
                </div>
                {formSaveError ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {formSaveError}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={!selectedContactId || !note.trim() || !dueDate || submitting || contacts.length === 0}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                  >
                    {submitting ? t("reminders.creating") : t("reminders.createSubmit")}
                  </motion.button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-800"
                  >
                    {t("reminders.cancel")}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <RemindersViewSwitch
              value={viewMode}
              onChange={setViewMode}
              options={[
                { key: "list", label: (<span className="inline-flex items-center gap-2"><List className="h-4 w-4" />Lista</span>) },
                { key: "kanban", label: (<span className="inline-flex items-center gap-2"><LayoutGrid className="h-4 w-4" />Kanban</span>) },
                { key: "agenda", label: (<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" />Agenda</span>) },
                { key: "calendar", label: (<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" />Calendário</span>) },
              ]}
            />

            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="relative min-w-[200px] max-w-xl flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("reminders.searchPlaceholder")}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={clsx("btn-secondary min-h-11 px-3 py-2 text-sm", filtersOpen && "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-950/40 dark:text-brand-200")}
              >
                <span className="inline-flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtros
                </span>
              </button>
            </div>
          </div>

          <AnimatePresence>
            {filtersOpen ? (
              <motion.div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30" variants={expandVariants} initial="hidden" animate="show" exit="exit">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Período</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {filters.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setFilter(f.key)}
                          className={clsx(
                            "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                            filter === f.key
                              ? "bg-brand-500 text-white"
                              : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200 dark:hover:bg-ink-900",
                          )}
                        >
                          {t(f.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Status</label>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="input-field mt-2">
                      <option value="all">Todos</option>
                      <option value="TODO">A fazer</option>
                      <option value="DOING">Em progresso</option>
                      <option value="DONE">Concluído</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Prioridade</label>
                    <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)} className="input-field mt-2">
                      <option value="all">Todas</option>
                      <option value="LOW">Baixa</option>
                      <option value="MEDIUM">Média</option>
                      <option value="HIGH">Alta</option>
                      <option value="URGENT">Urgente</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">IA Score mínimo</label>
                    <input type="number" min={0} max={100} value={iaMinScore} onChange={(e) => setIaMinScore(Number(e.target.value) || 0)} className="input-field mt-2" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">Intervalo</label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="input-field" />
                      <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="input-field" />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-ink-500 dark:text-ink-400">Pipeline e Responsável: em evolução (mantendo compatibilidade do modelo atual).</div>
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-3 py-2 text-sm"
                    onClick={() => {
                      setStatusFilter("all");
                      setPriorityFilter("all");
                      setIaMinScore(0);
                      setRangeStart("");
                      setRangeEnd("");
                      setFilter("all");
                    }}
                  >
                    Limpar filtros
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {listError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {listError}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : displayReminders.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 dark:border-ink-600 dark:bg-ink-900/40"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Bell className="mb-3 h-12 w-12 text-gray-300 dark:text-ink-600" />
            <p className="text-sm text-gray-500 dark:text-ink-400">{t("reminders.empty")}</p>
          </motion.div>
        ) : (
          <div>
            {viewMode === "list" ? (
              <div className="space-y-3">
                {displayReminders
                  .slice()
                  .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
                  .map((r) => (
                    <ReminderCard
                      key={r.id}
                      reminder={r}
                      dateLocale={dateLocale}
                      onOpen={() => openDetail(r)}
                      onToggleComplete={() => void toggleComplete(r.id, r.completed)}
                      onAi={() => openPlannerFor(r.contact.id, r.note)}
                      onDelete={() => void deleteReminder(r.id)}
                    />
                  ))}
              </div>
            ) : viewMode === "kanban" ? (
              <RemindersKanban
                reminders={displayReminders}
                dateLocale={dateLocale}
                onOpen={(r) => openDetail(r)}
                onToggleComplete={(r) => void toggleComplete(r.id, r.completed)}
                onAi={(r) => openPlannerFor(r.contact.id, r.note)}
                onMoveStatus={(id, st) => void moveStatus(id, st)}
                onDelete={(r) => void deleteReminder(r.id)}
              />
            ) : viewMode === "agenda" ? (
              <RemindersAgenda
                reminders={displayReminders}
                dateLocale={dateLocale}
                onOpen={(r) => openDetail(r)}
                onToggleComplete={(r) => void toggleComplete(r.id, r.completed)}
                onAi={(r) => openPlannerFor(r.contact.id, r.note)}
                onDelete={(r) => void deleteReminder(r.id)}
              />
            ) : (
              <div className="space-y-4">
                <RemindersCalendar
                  month={calendarMonth}
                  dateLocale={dateLocale}
                  reminders={displayReminders}
                  selectedDay={calendarDay}
                  onChangeMonth={setCalendarMonth}
                  onSelectDay={(d) => setCalendarDay(d)}
                />
                <div className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/30">
                  <div className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                    {calendarDay ? "Itens do dia" : "Itens (mês atual)"}
                  </div>
                  <div className="mt-3 space-y-3">
                    {(calendarDay
                      ? displayReminders.filter((r) => {
                          const d = new Date(r.dueAt);
                          return (
                            d.getFullYear() === calendarDay.getFullYear() &&
                            d.getMonth() === calendarDay.getMonth() &&
                            d.getDate() === calendarDay.getDate()
                          );
                        })
                      : displayReminders.filter((r) => {
                          const d = new Date(r.dueAt);
                          return d.getFullYear() === calendarMonth.getFullYear() && d.getMonth() === calendarMonth.getMonth();
                        })
                    )
                      .slice()
                      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
                      .slice(0, 20)
                      .map((r) => (
                        <ReminderCard
                          key={r.id}
                          reminder={r}
                          dateLocale={dateLocale}
                          onOpen={() => openDetail(r)}
                          onToggleComplete={() => void toggleComplete(r.id, r.completed)}
                          onAi={() => openPlannerFor(r.contact.id, r.note)}
                          onDelete={() => void deleteReminder(r.id)}
                        />
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ReminderDetailDrawer
        open={detailOpen}
        reminder={detailReminder}
        dateLocale={dateLocale}
        onClose={() => setDetailOpen(false)}
        onToggleComplete={(id, completed) => void toggleComplete(id, completed)}
        onDelete={(id) => void deleteReminder(id)}
        onSave={saveReminder}
        onOpenPlanner={(r) => openPlannerFor(r.contact.id, r.note)}
      />

      <AiPlannerDrawer
        open={plannerOpen}
        initialContactId={plannerInitial.contactId}
        initialGoal={plannerInitial.goal}
        onClose={() => setPlannerOpen(false)}
        onApplied={() => void fetchReminders(false)}
      />
    </PageTransition>
  );
}
