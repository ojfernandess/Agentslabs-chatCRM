import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import clsx from "clsx";
import { MessageCircle, SendHorizonal, WifiOff } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Web Chat externo (/s/:token) — continuidade da MESMA conversa do WhatsApp/Inbox.
 *
 * - mobile-first (viewport, safe areas, teclado virtual, scroll automático);
 * - layout de conversa familiar SEM se passar pelo WhatsApp oficial (sem logo/nome WhatsApp);
 * - realtime por polling incremental com estados CONNECTING / CONNECTED / RECONNECTING / OFFLINE;
 * - o conteúdo é sempre renderizado como texto puro (proteção XSS).
 */

type PublicMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  channel: string | null;
  status: string;
  createdAt: string;
};

type SessionInfo = {
  organizationName: string;
  agentName: string | null;
  expiresAt: string;
  humanActive: boolean;
};

type ConnectionState = "CONNECTING" | "CONNECTED" | "RECONNECTING" | "OFFLINE";

type SessionErrorCode = "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED";

const POLL_INTERVAL_MS = 3500;

function dayLabel(iso: string, todayLabel: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return todayLabel;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export default function WebChatPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useI18n();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<SessionErrorCode | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [humanActive, setHumanActive] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastCreatedAtRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);

  const base = `/api/v1/public/webchat/${encodeURIComponent(token)}`;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const mergeMessages = useCallback((incoming: PublicMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      const next = [...prev, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      lastCreatedAtRef.current = next[next.length - 1]?.createdAt ?? lastCreatedAtRef.current;
      return next;
    });
  }, []);

  /** Bootstrap: sessão + histórico completo da conversa. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sres = await fetch(`${base}/session`);
        if (!sres.ok) {
          const data = (await sres.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setSessionError(
              data?.error === "SESSION_EXPIRED" || data?.error === "SESSION_REVOKED"
                ? (data.error as SessionErrorCode)
                : "NOT_FOUND",
            );
          }
          return;
        }
        const sdata = (await sres.json()) as SessionInfo & { humanActive: boolean };
        const mres = await fetch(`${base}/messages`);
        const mdata = mres.ok
          ? ((await mres.json()) as { messages: PublicMessage[]; humanActive: boolean })
          : { messages: [], humanActive: false };
        if (cancelled) return;
        setSession(sdata);
        setHumanActive(Boolean(sdata.humanActive || mdata.humanActive));
        mergeMessages(mdata.messages);
        setConnection("CONNECTED");
        requestAnimationFrame(() => scrollToBottom());
      } catch {
        if (!cancelled) setConnection(navigator.onLine ? "RECONNECTING" : "OFFLINE");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, mergeMessages, scrollToBottom]);

  /** Polling incremental — mensagens novas aparecem sem reload. */
  useEffect(() => {
    if (!session || sessionError) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const since = lastCreatedAtRef.current;
          const res = await fetch(
            `${base}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`,
          );
          if (!res.ok) {
            if (res.status === 410) {
              const data = (await res.json().catch(() => null)) as { error?: string } | null;
              setSessionError(
                data?.error === "SESSION_REVOKED" ? "SESSION_REVOKED" : "SESSION_EXPIRED",
              );
              return;
            }
            setConnection("RECONNECTING");
            return;
          }
          const data = (await res.json()) as { messages: PublicMessage[]; humanActive: boolean };
          setHumanActive(Boolean(data.humanActive));
          if (data.messages.length > 0 && stickToBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom("smooth"));
          }
          mergeMessages(data.messages);
          setConnection("CONNECTED");
        } catch {
          setConnection(navigator.onLine ? "RECONNECTING" : "OFFLINE");
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [base, session, sessionError, mergeMessages, scrollToBottom]);

  /** Reconexão ao voltar online. */
  useEffect(() => {
    const onOnline = () => setConnection((c) => (c === "OFFLINE" ? "RECONNECTING" : c));
    const onOffline = () => setConnection("OFFLINE");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const content = draft.trim();
      if (!content || sending) return;
      setSending(true);
      try {
        const res = await fetch(`${base}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (res.status === 410) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setSessionError(data?.error === "SESSION_REVOKED" ? "SESSION_REVOKED" : "SESSION_EXPIRED");
          return;
        }
        if (!res.ok) {
          setConnection("RECONNECTING");
          return;
        }
        const data = (await res.json()) as { message: PublicMessage };
        setDraft("");
        stickToBottomRef.current = true;
        mergeMessages([data.message]);
        requestAnimationFrame(() => scrollToBottom("smooth"));
      } catch {
        setConnection(navigator.onLine ? "RECONNECTING" : "OFFLINE");
      } finally {
        setSending(false);
      }
    },
    [base, draft, sending, mergeMessages, scrollToBottom],
  );

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: PublicMessage[] }> = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt, t("webchat.today"), locale);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    }
    return groups;
  }, [messages, locale, t]);

  if (sessionError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-100 p-6 dark:bg-ink-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-ink-900">
          <MessageCircle className="mx-auto h-10 w-10 text-ink-400" />
          <h1 className="mt-4 text-lg font-bold text-ink-900 dark:text-ink-100">
            {sessionError === "SESSION_EXPIRED"
              ? t("webchat.expiredTitle")
              : sessionError === "SESSION_REVOKED"
                ? t("webchat.revokedTitle")
                : t("webchat.notFoundTitle")}
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {sessionError === "SESSION_EXPIRED" ? t("webchat.expiredBody") : t("webchat.notFoundBody")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-dvh flex-col bg-ink-100 dark:bg-ink-950"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Cabeçalho simples — identidade própria, sem se passar pelo WhatsApp oficial */}
      <header
        className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 shadow-sm dark:border-ink-800 dark:bg-ink-900"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink-900 dark:text-ink-100">
            {t("webchat.headerTitle")}
          </div>
          <div className="truncate text-xs text-ink-500">
            {session ? session.organizationName : t("webchat.connecting")}
            {humanActive ? ` · ${t("webchat.humanActive")}` : session?.agentName ? ` · ${session.agentName}` : ""}
          </div>
        </div>
        {connection !== "CONNECTED" ? (
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              connection === "OFFLINE"
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
            )}
          >
            {connection === "OFFLINE" ? <WifiOff className="h-3 w-3" /> : null}
            {connection === "CONNECTING"
              ? t("webchat.connecting")
              : connection === "RECONNECTING"
                ? t("webchat.reconnecting")
                : t("webchat.offline")}
          </span>
        ) : null}
      </header>

      {/* Lista de mensagens */}
      <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
          {grouped.map((group) => (
            <div key={group.day} className="flex flex-col gap-1.5">
              <div className="my-3 flex items-center justify-center">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink-500 shadow-sm dark:bg-ink-800 dark:text-ink-400">
                  {group.day}
                </span>
              </div>
              {group.items.map((m) => {
                const mine = m.direction === "INBOUND";
                return (
                  <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={clsx(
                        "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                        mine
                          ? "rounded-br-md bg-brand-600 text-white"
                          : "rounded-bl-md bg-white text-ink-900 dark:bg-ink-800 dark:text-ink-100",
                      )}
                    >
                      {m.body ? (
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      ) : m.mediaUrl ? (
                        <p className="italic opacity-80">{t("webchat.mediaMessage")}</p>
                      ) : null}
                      <div
                        className={clsx(
                          "mt-1 text-right text-[10px]",
                          mine ? "text-white/70" : "text-ink-400",
                        )}
                      >
                        {timeLabel(m.createdAt, locale)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {messages.length === 0 && connection === "CONNECTED" ? (
            <p className="py-10 text-center text-sm text-ink-500">{t("webchat.emptyState")}</p>
          ) : null}
        </div>
      </div>

      {/* Campo de mensagem */}
      <form
        onSubmit={send}
        className="border-t border-ink-200 bg-white px-3 py-2.5 dark:border-ink-800 dark:bg-ink-900"
      >
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={t("webchat.inputPlaceholder")}
            aria-label={t("webchat.inputPlaceholder")}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-ink-200 bg-ink-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-100"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label={t("webchat.sendLabel")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            <SendHorizonal className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
