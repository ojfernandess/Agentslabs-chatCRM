import { useCallback, useEffect, useState } from "react";
import { Clock, Delete, Keyboard, Phone, PhoneIncoming, PhoneOff, PhoneOutgoing, Users, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipSipPhoneOptional } from "@/contexts/NvoipSipPhoneContext";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;
type DialerTab = "keypad" | "contacts" | "history";

type ContactRow = { id: string; name: string; phone: string | null };
type HistoryRow = {
  id: string;
  direction: string;
  status: string;
  caller: string;
  receiver: string;
  createdAt: string;
  contact: { id: string; name: string; phone: string | null } | null;
};

export function SipDialer() {
  const { t } = useI18n();
  const sip = useNvoipSipPhoneOptional();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DialerTab>("keypad");
  const [number, setNumber] = useState("");
  const [dialError, setDialError] = useState<string | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setDialError(null);
      setTab("keypad");
    };
    window.addEventListener("openconduit:sip-dialer-open", onOpen);
    return () => window.removeEventListener("openconduit:sip-dialer-open", onOpen);
  }, []);

  const loadContacts = useCallback(async (term: string) => {
    try {
      const params = new URLSearchParams({ pageSize: "25" });
      if (term.trim()) params.set("search", term.trim());
      const res = await api.get<{ data: ContactRow[] }>(`/contacts?${params}`);
      setContacts((res.data ?? []).filter((row) => row.phone?.replace(/\D/g, "")));
    } catch {
      setContacts([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get<{ data: HistoryRow[] }>("/sip/calls/my-recent");
      setHistory(res.data ?? []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "contacts") return;
    const id = window.setTimeout(() => void loadContacts(contactQuery), 300);
    return () => window.clearTimeout(id);
  }, [open, tab, contactQuery, loadContacts]);

  useEffect(() => {
    if (!open || tab !== "history") return;
    void loadHistory();
  }, [open, tab, loadHistory]);

  if (!sip.enabled || !open) return null;
  if (sip.incoming && (sip.status === "ringing" || sip.status === "in-call")) return null;

  const registered = sip.status === "registered" || sip.status === "in-call" || sip.status === "ringing";
  const calling = sip.status === "ringing" || sip.status === "in-call";
  const callError =
    dialError ?? (sip.error?.startsWith("sip_call_failed") ? t("nvoip.softphone.callFailed") : null);

  const dial = (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setNumber(target);
    if (!registered) {
      setDialError(t("nvoip.sip.notRegistered"));
      return;
    }
    const ok = sip.placeCall(target);
    if (!ok) setDialError(t("nvoip.softphone.callFailed"));
    else setDialError(null);
  };

  const tabs: { id: DialerTab; label: string; icon: typeof Keyboard }[] = [
    { id: "keypad", label: t("nvoip.softphone.tabKeypad"), icon: Keyboard },
    { id: "contacts", label: t("nvoip.softphone.tabContacts"), icon: Users },
    { id: "history", label: t("nvoip.softphone.tabHistory"), icon: Clock },
  ];

  return (
    <section
      className="fixed bottom-4 right-4 z-[120] flex w-[min(100vw-2rem,360px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("nvoip.softphone.title")}
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-ink-800">
        <Phone className="h-4 w-4 text-brand-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-ink-50">{t("nvoip.softphone.title")}</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-ink-400">
            <span className={clsx("h-2 w-2 rounded-full", registered ? "bg-emerald-500" : "bg-slate-400")} />
            {calling
              ? sip.status === "in-call"
                ? t("nvoip.softphone.inCall")
                : t("nvoip.softphone.calling")
              : registered
                ? t("nvoip.softphone.available")
                : t("nvoip.sip.status.unregistered")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800"
          aria-label={t("nvoip.softphone.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-3 border-b border-slate-100 dark:border-ink-800">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={clsx(
              "inline-flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium",
              tab === item.id
                ? "border-b-2 border-brand-500 text-brand-600 dark:text-brand-300"
                : "text-slate-500 hover:text-slate-800 dark:text-ink-400 dark:hover:text-ink-100",
            )}
          >
            <item.icon className="h-3.5 w-3.5" aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4">
        {calling ? (
          <p className="text-center text-sm font-medium text-brand-600 dark:text-brand-300">
            {number ? <span className="mb-1 block text-lg tracking-wide text-slate-900 dark:text-ink-50">{number}</span> : null}
            {sip.status === "in-call" ? t("nvoip.softphone.inCall") : t("nvoip.softphone.calling")}
          </p>
        ) : tab === "keypad" ? (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-ink-700">
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") dial(number);
                }}
                inputMode="tel"
                placeholder={t("nvoip.softphone.dialPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-lg tracking-wide text-slate-900 outline-none dark:text-ink-50"
              />
              {number ? (
                <button
                  type="button"
                  onClick={() => setNumber((n) => n.slice(0, -1))}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-ink-100"
                  aria-label={t("nvoip.softphone.backspace")}
                >
                  <Delete className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNumber((n) => `${n}${key}`)}
                  className="rounded-xl bg-slate-50 py-3 text-lg font-semibold text-slate-900 hover:bg-slate-100 dark:bg-ink-950 dark:text-ink-50 dark:hover:bg-ink-800"
                >
                  {key}
                </button>
              ))}
            </div>
          </>
        ) : tab === "contacts" ? (
          <div>
            <input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder={t("nvoip.softphone.contactsSearch")}
              className="w-full rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none dark:border-ink-700 dark:text-ink-50"
            />
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {contacts.length === 0 ? (
                <li className="px-1 py-6 text-center text-xs text-slate-500 dark:text-ink-400">
                  {t("nvoip.softphone.contactsEmpty")}
                </li>
              ) : (
                contacts.map((contact) => (
                  <li key={contact.id}>
                    <button
                      type="button"
                      onClick={() => contact.phone && dial(contact.phone)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-800"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-ink-50">
                          {contact.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-ink-400">{contact.phone}</span>
                      </span>
                      <Phone className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {history.length === 0 ? (
              <li className="px-1 py-6 text-center text-xs text-slate-500 dark:text-ink-400">
                {t("nvoip.softphone.historyEmpty")}
              </li>
            ) : (
              history.map((row) => {
                const outgoing = row.direction === "OUTGOING";
                const phone = outgoing ? row.receiver : row.caller;
                const label = row.contact?.name?.trim() || phone;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => phone && dial(phone)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-800"
                    >
                      {outgoing ? (
                        <PhoneOutgoing className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      ) : (
                        <PhoneIncoming className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-ink-50">{label}</span>
                        <span className="block truncate text-xs text-slate-500 dark:text-ink-400">
                          {outgoing ? t("nvoip.softphone.historyOut") : t("nvoip.softphone.historyIn")}
                          {" · "}
                          {new Date(row.createdAt).toLocaleString()}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}

        {callError ? <p className="mt-3 text-center text-xs text-red-600">{callError}</p> : null}

        {calling ? (
          <button
            type="button"
            onClick={() => sip.hangup()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500"
          >
            <PhoneOff className="h-4 w-4" />
            {t("nvoip.softphone.endCall")}
          </button>
        ) : tab === "keypad" ? (
          <button
            type="button"
            disabled={!number.trim()}
            onClick={() => dial(number)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Phone className="h-4 w-4" />
            {t("nvoip.softphone.placeCall")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
