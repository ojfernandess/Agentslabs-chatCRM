import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, Loader2, Minus, Phone, PhoneOff, User } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipSipPhoneOptional } from "@/contexts/NvoipSipPhoneContext";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";

type ResolvedContact = {
  dialPhone: string;
  contact: { id: string; name: string; phone: string } | null;
  conversationId: string | null;
};

type EndedSummary = {
  title: string;
  phone: string;
  seconds: number;
  conversationId: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function formatElapsed(total: number): string {
  const mm = Math.floor(Math.max(0, total) / 60);
  const ss = String(Math.max(0, total) % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function NvoipSoftphonePanel() {
  const { t } = useI18n();
  const sip = useNvoipSipPhoneOptional();
  const voice = useNvoipVoiceOptional();
  const [contact, setContact] = useState<ResolvedContact | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [ended, setEnded] = useState<EndedSummary | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const liveRef = useRef<EndedSummary | null>(null);

  const inboundRinging = sip.status === "ringing" && !!sip.incoming && !voice?.activeCall;
  const inboundLive = sip.status === "in-call" && !voice?.activeCall;
  const visible = inboundRinging || inboundLive || !!ended;

  useEffect(() => {
    if (!inboundRinging) return;
    setMinimized(false);
    setEnded(null);
  }, [inboundRinging]);

  useEffect(() => {
    const phone = sip.incoming?.number?.trim();
    if (!phone) {
      setContact(null);
      return;
    }
    let cancelled = false;
    void api
      .get<ResolvedContact>(`/nvoip/calls/resolve-context?phone=${encodeURIComponent(phone)}`)
      .then((ctx) => {
        if (!cancelled) setContact(ctx);
      })
      .catch(() => {
        if (!cancelled) setContact(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sip.incoming?.number]);

  useEffect(() => {
    if (!inboundLive || !sip.answeredAt) return;
    const started = sip.answeredAt;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [inboundLive, sip.answeredAt]);

  const displayName =
    contact?.contact?.name?.trim() ||
    sip.incoming?.name?.trim() ||
    sip.incoming?.number?.trim() ||
    ended?.title ||
    t("nvoip.voice.unknownCaller");
  const displayPhone =
    contact?.contact?.phone || contact?.dialPhone || sip.incoming?.number || ended?.phone || "";
  const conversationId = contact?.conversationId ?? ended?.conversationId ?? null;

  if (inboundLive && sip.answeredAt) {
    liveRef.current = {
      title: displayName,
      phone: displayPhone,
      seconds: elapsed,
      conversationId,
    };
  }

  useEffect(() => {
    if (inboundLive) return;
    const live = liveRef.current;
    if (!live) return;
    if (sip.status === "ringing" || sip.status === "in-call") return;
    liveRef.current = null;
    setEnded({ ...live, seconds: live.seconds });
    setMinimized(false);
  }, [inboundLive, sip.status]);

  if (!sip.enabled || !visible) return null;

  const elapsedLabel = formatElapsed(inboundLive ? elapsed : (ended?.seconds ?? 0));

  if (minimized && inboundLive) {
    return (
      <div
        className="fixed bottom-4 right-4 z-[120] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-ink-700 dark:bg-ink-900"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left"
          aria-label={t("nvoip.softphone.expand")}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
            {initials(displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900 dark:text-ink-50">{displayName}</span>
            <span className="block text-xs text-slate-500 dark:text-ink-400">
              {t("nvoip.softphone.inCall")} · {formatElapsed(elapsed)}
            </span>
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("nvoip.voice.hangUp")}
          title={t("nvoip.voice.hangUp")}
          onClick={() => sip.hangup()}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 text-white hover:bg-red-500"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <section
      className="fixed z-[120] flex flex-col overflow-hidden border border-slate-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900 max-md:inset-x-0 max-md:bottom-0 max-md:top-0 max-md:rounded-none md:bottom-4 md:right-4 md:max-h-[calc(100dvh-2rem)] md:w-[380px] md:rounded-2xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("nvoip.softphone.title")}
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-ink-800">
        <Phone className="h-4 w-4 text-brand-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-ink-50">{t("nvoip.softphone.title")}</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-ink-400">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                inboundRinging ? "bg-amber-400" : inboundLive ? "bg-emerald-500" : "bg-slate-300",
              )}
            />
            {ended
              ? t("nvoip.softphone.ended")
              : inboundRinging
                ? t("nvoip.softphone.incoming")
                : t("nvoip.softphone.inCall")}
          </p>
        </div>
        {inboundLive ? (
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800"
            aria-label={t("nvoip.softphone.minimize")}
            title={t("nvoip.softphone.minimize")}
          >
            <Minus className="h-5 w-5" />
          </button>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-5 py-6">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-500 text-xl font-semibold text-white">
          {initials(displayName)}
        </span>
        <p className="mt-4 text-center text-lg font-semibold text-slate-900 dark:text-ink-50">{displayName}</p>
        {displayPhone ? (
          <p className="mt-1 text-center text-sm text-slate-500 dark:text-ink-400">{displayPhone}</p>
        ) : null}

        {ended ? (
          <div className="mt-6 w-full text-center">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("nvoip.softphone.ended")}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
              {t("nvoip.softphone.duration").replace("{time}", formatElapsed(ended.seconds))}
            </p>
          </div>
        ) : inboundLive ? (
          <p className="mt-4 text-2xl font-semibold tabular-nums text-slate-900 dark:text-ink-50">
            {elapsedLabel}
          </p>
        ) : (
          <p className="mt-4 text-sm font-medium text-brand-600 dark:text-brand-300">
            {sip.answering ? t("nvoip.softphone.connecting") : t("nvoip.softphone.incoming")}
          </p>
        )}

        {contact?.contact ? (
          <div className="mt-5 w-full rounded-xl bg-slate-50 p-3 text-sm dark:bg-ink-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("nvoip.softphone.contactInfo")}
            </p>
            <p className="mt-2 flex items-center gap-2 text-slate-800 dark:text-ink-100">
              <User className="h-4 w-4 text-slate-400" aria-hidden />
              {contact.contact.name}
            </p>
            <p className="mt-1 flex items-center gap-2 text-slate-600 dark:text-ink-300">
              <Phone className="h-4 w-4 text-slate-400" aria-hidden />
              {contact.contact.phone}
            </p>
          </div>
        ) : null}

        {conversationId ? (
          <Link
            to={`/conversations/${conversationId}`}
            className="mt-3 text-sm font-semibold text-brand-600 hover:text-brand-500"
          >
            {t("nvoip.softphone.viewConversation")}
          </Link>
        ) : null}

        {sip.error ? (
          <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">{t("nvoip.softphone.callFailed")}</p>
        ) : null}
      </div>

      <footer className="border-t border-slate-100 px-4 py-4 dark:border-ink-800">
        {ended ? (
          <button
            type="button"
            onClick={() => setEnded(null)}
            className="btn-primary h-12 w-full rounded-xl text-sm font-semibold"
          >
            {t("nvoip.softphone.done")}
          </button>
        ) : inboundRinging ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={sip.answering}
              onClick={() => sip.reject()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              <PhoneOff className="h-5 w-5" />
              {t("nvoip.softphone.reject")}
            </button>
            <button
              type="button"
              disabled={sip.answering}
              onClick={() => void sip.answer()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {sip.answering ? <Loader2 className="h-5 w-5 animate-spin" /> : <Phone className="h-5 w-5" />}
              {t("nvoip.softphone.answer")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => sip.hangup()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500"
          >
            <PhoneOff className="h-5 w-5" />
            {t("nvoip.softphone.endCall")}
          </button>
        )}
      </footer>
    </section>
  );
}
