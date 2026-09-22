import { useEffect, useCallback, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { AnimatePresence, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { translate } from "@/i18n/messages";
import { playIncomingCallRing } from "@/lib/audioAlerts";
import { invalidateCachedConversation } from "@/lib/conversationDetailCache";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presenceConfig";
import {
  getOrCreatePresenceSessionKey,
  sendPresenceSessionEndKeepalive,
  PRESENCE_SHUTDOWN_EVENT,
  isPresenceClientShutdown,
  resetPresenceClientShutdown,
} from "@/lib/presenceSession";
import {
  publishUserAvailabilityChanged,
  publishUserPresenceChanged,
  type UserAvailability,
} from "@/lib/userAvailability";
import { publishConversationAgentTyping } from "@/lib/conversationAgentTyping";
import { api } from "@/lib/api";
import {
  resolveTransferNotificationFromWs,
  type ConversationTransferredPayload,
} from "@/lib/transferNotification";
import { TransferNotificationToast } from "@/components/workspace/TransferNotificationToast";

const TOKEN_KEY = "openconduit_token";
const TOAST_DISMISS_MS = 6000;

type WorkspaceToast =
  | {
      id: string;
      kind: "transfer";
      createdAt: number;
      payload: ConversationTransferredPayload;
    }
  | {
      id: string;
      kind: "call";
      text: string;
    };

type NewWorkspaceToast =
  | {
      kind: "transfer";
      createdAt: number;
      payload: ConversationTransferredPayload;
    }
  | {
      kind: "call";
      text: string;
    };

function playTransferChime(): void {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.2);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* ignore */
  }
}

export function WorkspaceRealtime() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [toasts, setToasts] = useState<WorkspaceToast[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const pushToast = useCallback((toast: NewWorkspaceToast) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, TOAST_DISMISS_MS);
  }, [dismissToast]);

  useEffect(() => {
    if (!user) return;
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;

    resetPresenceClientShutdown();

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    const sessionKey = getOrCreatePresenceSessionKey();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const sendHeartbeat = () => {
      if (isPresenceClientShutdown()) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "presence.heartbeat", sessionKey }));
        } catch {
          /* ignore */
        }
        return;
      }
      void api
        .post<{ ok: boolean }>("/auth/me/presence/heartbeat", { sessionKey })
        .catch(() => {
          /* ignore transient errors */
        });
    };

    let cancelled = false;
    let retryAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}&sessionKey=${encodeURIComponent(sessionKey)}`;

    const handlePayload = (data: ConversationTransferredPayload & {
      type?: string;
      contact?: { name?: string };
      teamId?: string | null;
      teamName?: string | null;
      conversationId?: string;
      awaitingHumanHandoff?: boolean;
      typing?: boolean;
      botId?: string;
      botName?: string;
      caller?: string;
      deviceId?: string;
      whatsappCallId?: number;
      contactId?: string | null;
      status?: string;
      linkedPhone?: string | null;
      targetUserIds?: string[] | null;
      userId?: string;
      presenceConnected?: boolean;
      effectiveAvailabilityStatus?: string;
    }) => {
      if (data.type === "user.presence_changed" && data.userId && data.effectiveAvailabilityStatus) {
        publishUserPresenceChanged(
          data.userId,
          Boolean(data.presenceConnected),
          data.effectiveAvailabilityStatus as UserAvailability,
        );
        return;
      }
      if (data.type === "user.availability_changed" && data.userId && data.status) {
        publishUserAvailabilityChanged(
          data.userId,
          data.status as UserAvailability,
        );
        return;
      }
      if (data.type === "conversation.transferred") {
        pushToast({
          kind: "transfer",
          createdAt: Date.now(),
          payload: data,
        });
        playTransferChime();
        if (typeof data.conversationId === "string" && data.conversationId) {
          invalidateCachedConversation(data.conversationId);
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-updated", {
              detail: { conversationId: data.conversationId },
            }),
          );
        }
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-transferred", { detail: data }),
        );
      } else if (data.type === "conversation.updated" && typeof data.conversationId === "string") {
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-updated", {
            detail: { conversationId: data.conversationId, awaitingHumanHandoff: data.awaitingHumanHandoff },
          }),
        );
      } else if (
        (data.type === "conversation.read" || data.type === "conversation.unread") &&
        typeof data.conversationId === "string" &&
        typeof data.userId === "string" &&
        user?.id === data.userId
      ) {
        if (data.type === "conversation.read") {
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-read", {
              detail: { conversationId: data.conversationId },
            }),
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-unread", {
              detail: { conversationId: data.conversationId },
            }),
          );
        }
      } else if (
        data.type === "conversation.agent_typing" &&
        typeof data.conversationId === "string" &&
        typeof data.typing === "boolean"
      ) {
        publishConversationAgentTyping({
          conversationId: data.conversationId,
          typing: data.typing,
          botId: data.botId,
          botName: data.botName,
        });
      } else if (
        data.type === "wavoip.call.incoming" ||
        data.type === "threecx.call.incoming" ||
        data.type === "nvoip.call.incoming"
      ) {
        if (
          Array.isArray(data.targetUserIds) &&
          data.targetUserIds.length > 0 &&
          user?.id &&
          !data.targetUserIds.includes(user.id)
        ) {
          return;
        }
        const isThreeCx = data.type === "threecx.call.incoming";
        const isNvoip = data.type === "nvoip.call.incoming";
        const caller =
          (data.caller ?? "").trim() ||
          translate(
            localeRef.current,
            isThreeCx
              ? "threecx.voice.unknownCaller"
              : isNvoip
                ? "nvoip.voice.unknownCaller"
                : "wavoip.voice.unknownCaller",
          );
        const msg = translate(
          localeRef.current,
          isThreeCx
            ? "threecx.voice.incomingToast"
            : isNvoip
              ? "nvoip.voice.incomingToast"
              : "wavoip.voice.incomingToast",
        ).replace("{caller}", caller);
        pushToast({ kind: "call", text: msg });
        void playIncomingCallRing();
        const incomingEvent = isThreeCx
          ? "openconduit:threecx-call-incoming"
          : isNvoip
            ? "openconduit:nvoip-call-incoming"
            : "openconduit:wavoip-call-incoming";
        window.dispatchEvent(new CustomEvent(incomingEvent, { detail: data }));
        if (typeof data.conversationId === "string" && data.conversationId) {
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-updated", {
              detail: { conversationId: data.conversationId },
            }),
          );
          window.dispatchEvent(
            new CustomEvent("openconduit:wavoip-call-logged", {
              detail: {
                conversationId: data.conversationId,
                contactId: data.contactId ?? null,
              },
            }),
          );
        }
      } else if (data.type === "wavoip.device.updated") {
        window.dispatchEvent(new CustomEvent("openconduit:wavoip-device-updated", { detail: data }));
      } else if (data.type === "nvoip.call.updated") {
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-call-updated", { detail: data }));
        if (typeof data.conversationId === "string" && data.conversationId) {
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-updated", {
              detail: { conversationId: data.conversationId },
            }),
          );
        }
      } else if (data.type === "nvoip.call.ended") {
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-call-ended", { detail: data }));
        if (typeof data.conversationId === "string" && data.conversationId) {
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-updated", {
              detail: { conversationId: data.conversationId },
            }),
          );
        }
      } else if (data.type === "crm_flow.execution.updated") {
        window.dispatchEvent(
          new CustomEvent("openconduit:crm-flow-execution-updated", { detail: data }),
        );
      }
    };

    const connect = () => {
      if (cancelled || isPresenceClientShutdown()) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryAttempt = 0;
        sendHeartbeat();
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as Parameters<typeof handlePayload>[0];
          if (data.type === "workspace.connected") return;
          handlePayload(data);
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryAttempt, 5));
        retryAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    const stopPresenceTransport = (tokenForSessionEnd?: string) => {
      cancelled = true;
      if (heartbeatTimer != null) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (tokenForSessionEnd) sendPresenceSessionEndKeepalive(tokenForSessionEnd);
      const ws = wsRef.current;
      wsRef.current = null;
      if (!ws) return;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener("open", () => ws.close(1000, "presence shutdown"), { once: true });
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "presence shutdown");
      }
    };

    const onShutdown = (e: Event) => {
      const shutdownToken = (e as CustomEvent<{ token?: string | null }>).detail?.token;
      stopPresenceTransport(typeof shutdownToken === "string" ? shutdownToken : token);
    };

    connect();

    heartbeatTimer = setInterval(sendHeartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
    sendHeartbeat();

    const onPageHide = () => {
      sendPresenceSessionEndKeepalive(token);
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(PRESENCE_SHUTDOWN_EVENT, onShutdown);

    return () => {
      window.removeEventListener(PRESENCE_SHUTDOWN_EVENT, onShutdown);
      window.removeEventListener("pagehide", onPageHide);
      if (!isPresenceClientShutdown()) {
        stopPresenceTransport(token);
      }
    };
  }, [user, pushToast]);

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(calc(100vw-32px),420px)] max-w-[440px] flex-col gap-3"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((toast) =>
          toast.kind === "transfer" ? (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <TransferNotificationToast
                content={resolveTransferNotificationFromWs(toast.payload)}
                createdAt={toast.createdAt}
                onClose={() => dismissToast(toast.id)}
              />
            </motion.div>
          ) : (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto rounded-[11px] border border-emerald-200/90 bg-white px-4 py-3 text-sm shadow-[0_8px_24px_rgba(15,23,42,0.10)] dark:border-emerald-900/40 dark:bg-soft-surface-2 dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
            >
              <p className="text-ink-700 dark:text-soft-text-secondary">{toast.text}</p>
            </motion.div>
          ),
        )}
      </AnimatePresence>
    </div>
  );
}
