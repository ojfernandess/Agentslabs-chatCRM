import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Search, UserPlus, Loader2 } from "lucide-react";
type ContactRow = { id: string; name: string; phone: string; email: string | null };

export function ConversationsStartChatModal({
  open,
  onClose,
  onPickContact,
}: {
  open: boolean;
  onClose: () => void;
  onPickContact: (c: { id: string; name: string; phone: string }) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

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

  useEffect(() => {
    if (!open) return;
    void searchContacts(debounced);
  }, [open, debounced, searchContacts]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setDebounced("");
      setRows([]);
      setShowCreate(false);
      setNewName("");
      setNewPhone("");
      setError("");
    }
  }, [open]);

  const createContact = async () => {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name || !phone) {
      setError(t("conversations.startChatFillRequired"));
      return;
    }
    setCreateBusy(true);
    setError("");
    try {
      const created = await api.post<{ id: string; name: string; phone: string }>("/contacts", { name, phone });
      onPickContact({ id: created.id, name: created.name, phone: created.phone });
      onClose();
    } catch (e: unknown) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) {
        setError(t("conversations.startChatDuplicateHint"));
        void searchContacts(phone);
        setQ(phone);
      } else {
        setError(t("conversations.startChatCreateFailed"));
      }
    } finally {
      setCreateBusy(false);
    }
  };

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
              <p className="mt-0.5 text-xs text-gray-500 dark:text-ink-400">{t("conversations.startChatSubtitle")}</p>
            </div>

            <div className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-ink-500" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("conversations.startChatSearchPlaceholder")}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100 dark:placeholder:text-ink-500"
                  autoFocus
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
                          onClick={() => {
                            onPickContact({ id: c.id, name: c.name, phone: c.phone });
                            onClose();
                          }}
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
                    onClick={() => void createContact()}
                    className="mt-1 w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {createBusy ? t("conversations.startChatCreating") : t("conversations.startChatCreateAndContinue")}
                  </button>
                </div>
              ) : null}

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
