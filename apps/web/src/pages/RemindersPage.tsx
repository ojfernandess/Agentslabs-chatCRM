import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Bell, Check, Clock, AlertCircle, Plus, X, Search } from "lucide-react";
import clsx from "clsx";
import { format, isPast } from "date-fns";
import {
  PageTransition,
  motion,
  AnimatePresence,
  expandVariants,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";

interface Reminder {
  id: string;
  note: string;
  dueAt: string;
  completed: boolean;
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
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState("");

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

  async function fetchReminders(showSpinner: boolean) {
    if (showSpinner) setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("filter", filter);
      if (search.trim()) params.set("search", search.trim());
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
  }, [filter]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => void fetchReminders(false), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter-only loads handled above
  }, [search]);

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

  const filters: { key: string; labelKey: string }[] = [
    { key: "all", labelKey: "reminders.filterAll" },
    { key: "today", labelKey: "reminders.filterToday" },
    { key: "overdue", labelKey: "reminders.filterOverdue" },
    { key: "upcoming", labelKey: "reminders.filterUpcoming" },
  ];

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-ink-50">{t("reminders.title")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-ink-400">{t("reminders.subtitle")}</p>
          </div>
          <motion.button
            type="button"
            onClick={() => void openForm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            whileTap={{ scale: 0.97 }}
          >
            <Plus className="h-4 w-4" />
            {t("reminders.newReminder")}
          </motion.button>
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
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-ink-800"
                >
                  <X className="h-4 w-4" />
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

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  filter === f.key
                    ? "bg-brand-500 text-white"
                    : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700",
                )}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("reminders.searchPlaceholder")}
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
            />
          </div>
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
        ) : reminders.length === 0 ? (
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
          <div className="space-y-2">
            {reminders.map((reminder) => {
              const due = new Date(reminder.dueAt);
              const overdue = isPast(due) && !reminder.completed;

              return (
                <div
                  key={reminder.id}
                  className={clsx(
                    "flex items-start gap-4 rounded-xl border bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-ink-900/60",
                    overdue ? "border-red-200 dark:border-red-900/50" : "border-gray-200 dark:border-ink-700",
                  )}
                >
                  <motion.button
                    type="button"
                    onClick={() => void toggleComplete(reminder.id, reminder.completed)}
                    className={clsx(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      reminder.completed
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-gray-300 hover:border-brand-400 dark:border-ink-500",
                    )}
                    whileTap={{ scale: 0.85 }}
                  >
                    {reminder.completed && <Check className="h-3 w-3" />}
                  </motion.button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={clsx(
                        "text-sm transition-all",
                        reminder.completed ? "text-gray-400 line-through dark:text-ink-500" : "text-gray-900 dark:text-ink-100",
                      )}
                    >
                      {reminder.note}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <Link
                        to={`/contacts/${reminder.contact.id}`}
                        className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {reminder.contact.name}
                      </Link>
                      <span
                        className={clsx(
                          "flex items-center gap-1 text-xs",
                          overdue ? "text-red-500" : "text-gray-400 dark:text-ink-400",
                        )}
                      >
                        {overdue ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {format(due, "PPp", { locale: dateLocale })}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteReminder(reminder.id)}
                    className="rounded-md p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-ink-500 dark:hover:bg-red-950/40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
