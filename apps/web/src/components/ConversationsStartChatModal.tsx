import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowRight, Phone, Search, UserPlus, Loader2 } from "lucide-react";

type ContactRow = { id: string; name: string; phone: string; email: string | null };
type StartMode = "search" | "quick";

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function phonesMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function pickPhoneMatch(rows: ContactRow[], term: string): ContactRow | null {
  const digits = phoneDigits(term);
  if (!digits) return null;
  const exact = rows.find((r) => phoneDigits(r.phone) === digits);
  if (exact) return exact;
  return rows.find((r) => phonesMatch(r.phone, term)) ?? null;
}

export function ConversationsStartChatModal({
  open,
  onClose,
  onPickContact,
  quickContactAddEnabled = false,
}: {
  open: boolean;
  onClose: () => void;
  onPickContact: (c: { id: string; name: string; phone: string }) => void;
  quickContactAddEnabled?: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<StartMode>("search");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState("");

  const [quickPhone, setQuickPhone] = useState("");
  const [quickDebounced, setQuickDebounced] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickMatch, setQuickMatch] = useState<ContactRow | null>(null);
  const [quickLookupBusy, setQuickLookupBusy] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const id = window.setTimeout(() => setQuickDebounced(quickPhone.trim()), 300);
    return () => window.clearTimeout(id);
  }, [quickPhone]);

  const searchContacts = useCallback(async (term: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ pageSize: "20" });
      if (term) params.set("search", term);
      const res = await api.get<{ data: ContactRow[] }>(`/contacts?${params}`);
      setRows(res.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const lookupQuickPhone = useCallback(async (term: string) => {
    const digits = phoneDigits(term);
    if (digits.length < 4) {
      setQuickMatch(null);
      return;
    }
    setQuickLookupBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ pageSize: "20", search: term.trim() });
      const res = await api.get<{ data: ContactRow[] }>(`/contacts?${params}`);
      setQuickMatch(pickPhoneMatch(res.data ?? [], term));
    } catch {
      setQuickMatch(null);
    } finally {
      setQuickLookupBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open || mode !== "search") return;
    void searchContacts(debounced);
  }, [open, debounced, mode, searchContacts]);

  useEffect(() => {
    if (!open || mode !== "quick" || !quickContactAddEnabled) return;
    void lookupQuickPhone(quickDebounced);
  }, [open, quickDebounced, mode, quickContactAddEnabled, lookupQuickPhone]);

  useEffect(() => {
    if (!open) {
      setMode(quickContactAddEnabled ? "quick" : "search");
      setQ("");
      setDebounced("");
      setRows([]);
      setShowCreate(false);
      setNewName("");
      setNewPhone("");
      setQuickPhone("");
      setQuickDebounced("");
      setQuickName("");
      setQuickMatch(null);
      setError("");
    } else if (quickContactAddEnabled) {
      setMode("quick");
    }
  }, [open, quickContactAddEnabled]);

  const quickDigits = phoneDigits(quickPhone);
  const quickReadyToCreate = quickDigits.length >= 7 && !quickMatch;

  const pickContact = (c: { id: string; name: string; phone: string }) => {
    onPickContact(c);
    onClose();
  };

  const createContact = async (name: string, phone: string) => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || !trimmedPhone) {
      setError(t("conversations.startChatFillRequired"));
      return;
    }
    setCreateBusy(true);
    setError("");
    try {
      const created = await api.post<{ id: string; name: string; phone: string }>("/contacts", {
        name: trimmedName,
        phone: trimmedPhone,
      });
      pickContact({ id: created.id, name: created.name, phone: created.phone });
    } catch (e: unknown) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) {
        setError(t("conversations.startChatDuplicateHint"));
        if (mode === "quick") {
          void lookupQuickPhone(trimmedPhone);
        } else {
          void searchContacts(trimmedPhone);
          setQ(trimmedPhone);
        }
      } else {
        setError(t("conversations.startChatCreateFailed"));
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const continueQuick = () => {
    if (quickMatch) {
      pickContact(quickMatch);
      return;
    }
    if (!quickReadyToCreate) {
      setError(t("conversations.startChatQuickPhoneTooShort"));
      return;
    }
    const name = quickName.trim() || quickPhone.trim();
    void createContact(name, quickPhone.trim());
  };

  const modeTabs = useMemo(
    () =>
      quickContactAddEnabled ? (
        <div
          className="mb-3 flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-ink-700 dark:bg-ink-950/60"
          role="tablist"
          aria-label={t("conversations.startChatModeLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quick"}
            onClick={() => {
              setMode("quick");
              setError("");
            }}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition",
              mode === "quick"
                ? "bg-white text-brand-700 shadow-sm dark:bg-ink-900 dark:text-brand-300"
                : "text-gray-600 hover:text-gray-900 dark:text-ink-400 dark:hover:text-ink-100",
            )}
          >
            <Phone className="h-3.5 w-3.5" />
            {t("conversations.startChatModeQuick")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "search"}
            onClick={() => {
              setMode("search");
              setError("");
            }}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition",
              mode === "search"
                ? "bg-white text-brand-700 shadow-sm dark:bg-ink-900 dark:text-brand-300"
                : "text-gray-600 hover:text-gray-900 dark:text-ink-400 dark:hover:text-ink-100",
            )}
          >
            <Search className="h-3.5 w-3.5" />
            {t("conversations.startChatModeSearch")}
          </button>
        </div>
      ) : null,
    [mode, quickContactAddEnabled, t],
  );

  const quickPanel = (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-ink-400">{t("conversations.startChatQuickHint")}</p>
      <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">
        {t("contactEdit.fieldPhone")}
        <div className="relative mt-1">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-ink-500" />
          <input
            type="tel"
            value={quickPhone}
            onChange={(e) => {
              setQuickPhone(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (quickMatch || quickReadyToCreate) && !createBusy) {
                e.preventDefault();
                continueQuick();
              }
            }}
            placeholder={t("conversations.startChatQuickPhonePlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100 dark:placeholder:text-ink-500"
            autoFocus
          />
        </div>
      </label>

      {quickLookupBusy ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-ink-800 dark:bg-ink-950/40">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          <span className="text-xs text-gray-500 dark:text-ink-400">{t("conversations.startChatQuickLookingUp")}</span>
        </div>
      ) : quickMatch ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
            {t("conversations.startChatQuickFound")}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-ink-50">{quickMatch.name}</p>
          <p className="text-xs text-gray-600 dark:text-ink-300">{quickMatch.phone}</p>
          <button
            type="button"
            onClick={() => pickContact(quickMatch)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {t("conversations.startChatQuickContinue")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : quickReadyToCreate ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900/40 dark:bg-brand-950/20">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
            {t("conversations.startChatQuickNewNumber")}
          </p>
          <label className="mt-2 block text-xs font-medium text-gray-600 dark:text-ink-300">
            {t("conversations.startChatQuickNameOptional")}
            <input
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !createBusy) {
                  e.preventDefault();
                  continueQuick();
                }
              }}
              placeholder={quickPhone.trim() || t("contactEdit.fieldName")}
              className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
            />
          </label>
          <button
            type="button"
            disabled={createBusy}
            onClick={() => continueQuick()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {createBusy ? t("conversations.startChatCreating") : t("conversations.startChatQuickCreateContinue")}
            {!createBusy ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </div>
      ) : quickDigits.length > 0 && quickDigits.length < 7 ? (
        <p className="text-xs text-gray-500 dark:text-ink-400">{t("conversations.startChatQuickPhoneTooShort")}</p>
      ) : null}
    </div>
  );

  const searchPanel = (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-ink-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("conversations.startChatSearchPlaceholder")}
          className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100 dark:placeholder:text-ink-500"
          autoFocus={!quickContactAddEnabled}
        />
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-gray-100 dark:border-ink-800">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-500 dark:text-ink-400">
            {debounced ? t("conversations.startChatNoResults") : t("conversations.startChatTypeToSearch")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-ink-800">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pickContact(c)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-ink-800/80"
                >
                  <span className="font-medium text-gray-900 dark:text-ink-50">{c.name}</span>
                  <span className="text-xs text-gray-500 dark:text-ink-400">{c.phone}</span>
                  {c.email ? (
                    <span className="text-xs text-gray-400 dark:text-ink-500">{c.email}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setShowCreate((v) => !v);
          setError("");
        }}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-700 transition hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-800 dark:border-ink-600 dark:text-ink-200 dark:hover:border-brand-500/50 dark:hover:bg-brand-950/30"
      >
        <UserPlus className="h-4 w-4" />
        {t("conversations.startChatNewContact")}
      </button>

      {showCreate ? (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-ink-700 dark:bg-ink-950/50">
          <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">
            {t("contactEdit.fieldName")}
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
            />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">
            {t("contactEdit.fieldPhone")}
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
            />
          </label>
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void createContact(newName, newPhone)}
            className="mt-1 w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {createBusy ? t("conversations.startChatCreating") : t("conversations.startChatCreateAndContinue")}
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 dark:bg-black/60"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-100 px-4 py-3 dark:border-ink-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-ink-50">{t("conversations.startChatTitle")}</h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-ink-400">
                {quickContactAddEnabled && mode === "quick"
                  ? t("conversations.startChatQuickSubtitle")
                  : t("conversations.startChatSubtitle")}
              </p>
            </div>

            <div className="p-4">
              {modeTabs}
              {quickContactAddEnabled && mode === "quick" ? quickPanel : searchPanel}
              {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            </div>

            <div className="border-t border-gray-100 px-4 py-2 dark:border-ink-800">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg py-2 text-center text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                {t("common.cancel")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
