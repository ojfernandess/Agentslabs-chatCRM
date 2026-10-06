import { useEffect, useState } from "react";
import { Delete, Phone, PhoneOff, X } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipSipPhoneOptional } from "@/contexts/NvoipSipPhoneContext";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

export function SipDialer() {
  const { t } = useI18n();
  const sip = useNvoipSipPhoneOptional();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [dialError, setDialError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setDialError(null);
    };
    window.addEventListener("openconduit:sip-dialer-open", onOpen);
    return () => window.removeEventListener("openconduit:sip-dialer-open", onOpen);
  }, []);

  if (!sip.enabled || !open) return null;
  if (sip.incoming && (sip.status === "ringing" || sip.status === "in-call")) return null;

  const registered = sip.status === "registered" || sip.status === "in-call" || sip.status === "ringing";
  const calling = sip.status === "ringing" || sip.status === "in-call";

  const dial = () => {
    if (!number.trim()) return;
    if (!registered) {
      setDialError(t("nvoip.sip.notRegistered"));
      return;
    }
    const ok = sip.placeCall(number);
    if (!ok) setDialError(t("nvoip.softphone.callFailed"));
    else setDialError(null);
  };

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
            {calling ? t("nvoip.softphone.calling") : registered ? t("nvoip.softphone.available") : t("nvoip.sip.status.unregistered")}
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

      <div className="px-4 py-4">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-ink-700">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
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

        {!calling ? (
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
        ) : (
          <p className="mt-6 text-center text-sm font-medium text-brand-600 dark:text-brand-300">
            {sip.status === "in-call" ? t("nvoip.softphone.inCall") : t("nvoip.softphone.calling")}
          </p>
        )}

        {dialError ? <p className="mt-3 text-center text-xs text-red-600">{dialError}</p> : null}

        {calling ? (
          <button
            type="button"
            onClick={() => sip.hangup()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500"
          >
            <PhoneOff className="h-4 w-4" />
            {t("nvoip.softphone.endCall")}
          </button>
        ) : (
          <button
            type="button"
            disabled={!number.trim()}
            onClick={dial}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Phone className="h-4 w-4" />
            {t("nvoip.softphone.placeCall")}
          </button>
        )}
      </div>
    </section>
  );
}
