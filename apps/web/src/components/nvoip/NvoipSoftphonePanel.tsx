import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { differenceInHours } from "date-fns";
import { ChevronUp, Keyboard, Loader2, MessageSquare, Mic, MicOff, Minus, Phone, PhoneOff, User } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipSipPhoneOptional } from "@/contexts/NvoipSipPhoneContext";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { ComposerTemplatePickerModal } from "@/components/ComposerTemplatePickerModal";
import { TemplateSendModal, type TemplateSendModalTemplate } from "@/components/TemplateSendModal";

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

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

function formatElapsed(total: number): string {
  const mm = Math.floor(Math.max(0, total) / 60);
  const ss = String(Math.max(0, total) % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

type ConversationWindow = {
  id: string;
  contactId: string;
  inboxId: string | null;
  outsideWindow: boolean;
};

function applies24hSessionPolicy(provider: string | null): boolean {
  return provider === "meta" || provider === "360dialog" || provider === "twilio" || provider == null;
}

export function StartConversationAction({
  phone,
  contactId,
  conversationId,
  compact = false,
  inline = false,
}: {
  phone: string;
  contactId: string | null;
  conversationId: string | null;
  compact?: boolean;
  inline?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<ConversationWindow | null>(null);
  const [templates, setTemplates] = useState<TemplateSendModalTemplate[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateSendModalTemplate | null>(null);

  const openConversation = (id: string) => {
    navigate(`/conversations/${id}`);
  };

  const start = async () => {
    const trimmed = phone.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    setOffer(null);
    try {
      let nextConversationId = conversationId;
      let nextContactId = contactId;
      if (!nextConversationId) {
        const ctx = await api.get<ResolvedContact>(
          `/nvoip/calls/resolve-context?phone=${encodeURIComponent(trimmed)}`,
        );
        nextConversationId = ctx.conversationId;
        nextContactId = ctx.contact?.id ?? nextContactId;
      }
      if (!nextConversationId || !nextContactId) {
        setError(t("nvoip.softphone.noConversation"));
        return;
      }

      const conversation = await api.get<{
        id: string;
        inbox?: { id: string; channelType?: string } | null;
        messages?: { direction: string; createdAt: string }[];
      }>(`/conversations/${nextConversationId}`);
      const inboxId = conversation.inbox?.id ?? null;
      let provider: string | null = null;
      if (inboxId) {
        try {
          const channel = await api.get<{ whatsappProvider?: string | null }>(
            `/settings/channel?inboxId=${encodeURIComponent(inboxId)}`,
          );
          provider = channel.whatsappProvider ?? null;
        } catch {
          provider = null;
        }
      }
      const inbound = [...(conversation.messages ?? [])]
        .filter((message) => message.direction === "INBOUND" && message.createdAt)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const lastInbound = inbound.at(-1);
      const outsideWindow =
        conversation.inbox?.channelType !== "EMAIL" &&
        applies24hSessionPolicy(provider) &&
        (lastInbound ? differenceInHours(new Date(), new Date(lastInbound.createdAt)) > 24 : true);

      if (!outsideWindow) {
        openConversation(nextConversationId);
        return;
      }

      let list: Array<TemplateSendModalTemplate & { providerTemplateId?: string | null }> = [];
      try {
        const query = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : "";
        const rows = await api.get<Array<TemplateSendModalTemplate & { providerTemplateId?: string | null }>>(
          `/templates${query}`,
        );
        list = (Array.isArray(rows) ? rows : []).map((row) => ({
          ...row,
          bodyVariableCount: typeof row.bodyVariableCount === "number" ? row.bodyVariableCount : 0,
        }));
        if (provider === "evolution" || provider === "evolution_go") {
          list = list.filter((row) => !row.providerTemplateId?.trim());
        } else if (provider === "meta" || provider === "360dialog") {
          list = list.filter((row) => Boolean(row.metaCategory?.trim() || row.providerTemplateId?.trim()));
        }
      } catch {
        list = [];
      }
      setTemplates(list);
      setOffer({
        id: nextConversationId,
        contactId: nextContactId,
        inboxId,
        outsideWindow: true,
      });
    } catch {
      setError(t("nvoip.softphone.startFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={inline ? "relative shrink-0" : compact ? "mt-2 w-full" : "mt-4 w-full"}>
      <button
        type="button"
        disabled={busy}
        title={t("nvoip.softphone.startConversation")}
        aria-label={t("nvoip.softphone.startConversation")}
        onClick={(event) => {
          event.stopPropagation();
          void start();
        }}
        className={
          inline
            ? "inline-flex h-9 w-9 items-center justify-center rounded-xl text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-ink-800"
            : "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-100 dark:hover:bg-ink-800"
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : inline ? <MessageSquare className="h-4 w-4" /> : null}
        {inline ? null : t("nvoip.softphone.startConversation")}
      </button>
      {offer ? (
        <div
          className={
            inline
              ? "absolute right-0 top-10 z-20 w-56 rounded-xl bg-white px-3 py-3 text-left shadow-lg ring-1 ring-slate-200 dark:bg-ink-900 dark:ring-ink-700"
              : "mt-3 rounded-xl bg-slate-50 px-3 py-3 dark:bg-ink-950"
          }
        >
          <p className="text-xs text-slate-500 dark:text-ink-400">{t("nvoip.softphone.windowClosed")}</p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-2 text-sm font-semibold text-brand-600 hover:text-brand-500"
          >
            {t("nvoip.softphone.sendTemplate")}
          </button>
        </div>
      ) : null}
      {error ? (
        <p
          className={
            inline
              ? "absolute right-0 top-10 z-20 w-56 rounded-xl bg-white px-3 py-2 text-left text-xs text-red-600 shadow-lg ring-1 ring-slate-200 dark:bg-ink-900 dark:text-red-400 dark:ring-ink-700"
              : "mt-2 text-center text-xs text-red-600 dark:text-red-400"
          }
        >
          {error}
        </p>
      ) : null}
      <ComposerTemplatePickerModal
        open={pickerOpen}
        templates={templates}
        onClose={() => setPickerOpen(false)}
        onSelect={(selected) => {
          setPickerOpen(false);
          setTemplate(selected);
        }}
      />
      <TemplateSendModal
        open={template !== null}
        template={template}
        contactId={offer?.contactId ?? contactId ?? ""}
        conversationId={offer?.id ?? conversationId ?? undefined}
        inboxId={offer?.inboxId ?? undefined}
        onClose={() => setTemplate(null)}
        onSent={() => {
          const id = offer?.id ?? conversationId;
          if (id) openConversation(id);
        }}
      />
    </div>
  );
}

export function NvoipSoftphonePanel() {
  const { t } = useI18n();
  const sip = useNvoipSipPhoneOptional();
  const voice = useNvoipVoiceOptional();
  const [contact, setContact] = useState<ResolvedContact | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [ended, setEnded] = useState<EndedSummary | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showPad, setShowPad] = useState(false);
  const liveRef = useRef<EndedSummary | null>(null);

  useEffect(() => {
    const onFocus = () => setMinimized(false);
    window.addEventListener("openconduit:nvoip-sip-focus", onFocus);
    return () => window.removeEventListener("openconduit:nvoip-sip-focus", onFocus);
  }, []);

  const inboundRinging = sip.status === "ringing" && !!sip.incoming && !voice?.activeCall;
  const inboundLive = sip.status === "in-call" && !voice?.activeCall;
  const visible = inboundRinging || inboundLive || !!ended || sip.queue.length > 0;

  useEffect(() => {
    if (sip.queue.length === 0) return;
    setMinimized(false);
    setEnded(null);
  }, [sip.queue.length]);

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
        className="fixed bottom-4 right-4 z-[120] flex max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-ink-700 dark:bg-ink-900"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2">
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
              {sip.queue.length > 0
                ? ` · ${t("nvoip.softphone.queueCount").replace("{count}", String(sip.queue.length))}`
                : ""}
            </span>
            </span>
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={sip.muted ? t("nvoip.softphone.unmute") : t("nvoip.softphone.mute")}
            aria-pressed={sip.muted}
            title={sip.muted ? t("nvoip.softphone.unmute") : t("nvoip.softphone.mute")}
            onClick={() => sip.toggleMute()}
            className={clsx(
              "inline-flex h-11 w-11 items-center justify-center rounded-xl",
              sip.muted
                ? "bg-amber-500 text-white"
                : "bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-ink-100",
            )}
          >
            {sip.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
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
        {displayPhone ? (
          <StartConversationAction
            compact
            phone={displayPhone}
            contactId={contact?.contact?.id ?? null}
            conversationId={conversationId}
          />
        ) : null}
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
            {!ended && sip.queue.length > 0
              ? ` · ${t("nvoip.softphone.queueCount").replace("{count}", String(sip.queue.length))}`
              : ""}
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

        {displayPhone ? (
          <StartConversationAction
            phone={displayPhone}
            contactId={contact?.contact?.id ?? null}
            conversationId={conversationId}
          />
        ) : null}

        {conversationId ? (
          <Link
            to={`/conversations/${conversationId}`}
            className="mt-3 text-sm font-semibold text-brand-600 hover:text-brand-500"
          >
            {t("nvoip.softphone.viewConversation")}
          </Link>
        ) : null}

        {sip.queue.length > 0 ? (
          <div className="mt-5 w-full">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("nvoip.softphone.queueTitle")}
            </p>
            <ul className="mt-2 space-y-2">
              {sip.queue.map((call) => {
                const label = call.name || call.number || t("nvoip.voice.unknownCaller");
                return (
                  <li
                    key={call.id}
                    className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-ink-950"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900 dark:text-ink-50">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-ink-400">
                        {call.held
                          ? t("nvoip.softphone.queueHeld")
                          : call.number || t("nvoip.softphone.queueWaiting")}
                      </span>
                    </span>
                    {call.held ? (
                      <button
                        type="button"
                        onClick={() => void sip.resumeQueued(call.id)}
                        className="h-9 shrink-0 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white"
                      >
                        {t("nvoip.softphone.queueResume")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void sip.answerQueued(call.id)}
                        className="h-9 shrink-0 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white"
                      >
                        {t("nvoip.softphone.answer")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => sip.rejectQueued(call.id)}
                      className="h-9 shrink-0 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white"
                    >
                      {call.held ? t("nvoip.softphone.endCall") : t("nvoip.softphone.reject")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
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
        ) : inboundRinging && !sip.answering ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => sip.reject()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500"
            >
              <PhoneOff className="h-5 w-5" />
              {t("nvoip.softphone.reject")}
            </button>
            <button
              type="button"
              onClick={() => void sip.answer()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Phone className="h-5 w-5" />
              {t("nvoip.softphone.answer")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[3.5rem_3.5rem_1fr] gap-2">
              <button
                type="button"
                disabled={sip.status !== "in-call"}
                aria-pressed={sip.muted}
                aria-label={sip.muted ? t("nvoip.softphone.unmute") : t("nvoip.softphone.mute")}
                title={sip.muted ? t("nvoip.softphone.unmute") : t("nvoip.softphone.mute")}
                onClick={() => sip.toggleMute()}
                className={clsx(
                  "inline-flex h-12 items-center justify-center rounded-xl disabled:opacity-50",
                  sip.muted
                    ? "bg-amber-500 text-white"
                    : "bg-slate-100 text-slate-800 dark:bg-ink-800 dark:text-ink-100",
                )}
              >
                {sip.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                type="button"
                disabled={sip.status !== "in-call"}
                aria-pressed={showPad}
                aria-label={t("nvoip.softphone.keypad")}
                title={t("nvoip.softphone.keypad")}
                onClick={() => setShowPad((open) => !open)}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800 disabled:opacity-50 dark:bg-ink-800 dark:text-ink-100"
              >
                <Keyboard className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => sip.hangup()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-500"
              >
                {sip.answering ? <Loader2 className="h-5 w-5 animate-spin" /> : <PhoneOff className="h-5 w-5" />}
                {t("nvoip.softphone.endCall")}
              </button>
            </div>
            {showPad && sip.status === "in-call" ? (
              <div className="grid grid-cols-3 gap-2">
                {DTMF_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => sip.sendDtmf(key)}
                    className="h-11 rounded-xl bg-slate-50 text-base font-semibold text-slate-900 hover:bg-slate-100 dark:bg-ink-950 dark:text-ink-50 dark:hover:bg-ink-800"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </footer>
    </section>
  );
}
