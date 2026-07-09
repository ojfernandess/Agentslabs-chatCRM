import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, UserRound } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { contactEmailDisplay } from "@/lib/contactEmailDisplay";

type ContactRow = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
};

type Props = {
  onPick: (contact: { name: string; email: string }) => void;
  disabled?: boolean;
};

export function EmailContactPicker({ onPick, disabled }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchContacts = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "20", hasEmail: "1" });
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
      setQuery("");
      setDebounced("");
      setRows([]);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
      >
        <UserRound className="h-3.5 w-3.5" />
        {t("inboxesPage.emailWorkspace.composePickContact")}
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-950">
          <div className="border-b border-ink-100 p-2 dark:border-ink-800">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("inboxesPage.emailWorkspace.composeContactSearch")}
                className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-8 pr-3 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                autoFocus
              />
            </label>
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {loading ? (
              <li className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-ink-500">
                {debounced
                  ? t("inboxesPage.emailWorkspace.composeContactNoResults")
                  : t("inboxesPage.emailWorkspace.composeContactTypeToSearch")}
              </li>
            ) : (
              rows.map((contact) => {
                const email = contactEmailDisplay(contact);
                if (!email) return null;
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      className={clsx(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition hover:bg-ink-50 dark:hover:bg-ink-900/60",
                      )}
                      onClick={() => {
                        onPick({ name: contact.name, email });
                        setOpen(false);
                      }}
                    >
                      <span className="text-sm font-medium text-ink-900 dark:text-ink-50">{contact.name}</span>
                      <span className="truncate text-xs text-ink-500 dark:text-ink-400">{email}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
