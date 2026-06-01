import { useEffect, useCallback, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { AnimatePresence, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { translate } from "@/i18n/messages";
import { playIncomingCallRing } from "@/lib/audioAlerts";

const TOKEN_KEY = "openconduit_token";

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
  const { t, locale } = useI18n();
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const pushToast = useCallback((text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 6000);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    let cancelled = false;
    let retryAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;

    const handlePayload = (data: {
      type?: string;
      contact?: { name?: string };
      teamId?: string | null;
      teamName?: string | null;
      conversationId?: string;
      awaitingHumanHandoff?: boolean;
      caller?: string;
      deviceId?: string;
      whatsappCallId?: number;
      contactId?: string | null;
      status?: string;
      linkedPhone?: string | null;
      targetUserIds?: string[] | null;
    }) => {
      if (data.type === "conversation.transferred") {
        const contact = data.contact?.name ?? "—";
        const team = (data.teamName ?? "").trim() || translate(locale, "workspace.transferUnknownTeam");
        const msg = translate(locale, "workspace.transferToast")
          .replace("{contact}", contact)
          .replace("{team}", team);
        pushToast(msg);
        playTransferChime();
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-transferred", { detail: data }),
        );
      } else if (data.type === "conversation.updated" && typeof data.conversationId === "string") {
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-updated", {
            detail: { conversationId: data.conversationId, awaitingHumanHandoff: data.awaitingHumanHandoff },
          }),
        );
      } else if (data.type === "wavoip.call.incoming" || data.type === "threecx.call.incoming") {
        if (
          Array.isArray(data.targetUserIds) &&
          data.targetUserIds.length > 0 &&
          user?.id &&
          !data.targetUserIds.includes(user.id)
        ) {
          return;
        }
        const isThreeCx = data.type === "threecx.call.incoming";
        const caller =
          (data.caller ?? "").trim() ||
          translate(locale, isThreeCx ? "threecx.voice.unknownCaller" : "wavoip.voice.unknownCaller");
        const msg = translate(
          locale,
          isThreeCx ? "threecx.voice.incomingToast" : "wavoip.voice.incomingToast",
        ).replace("{caller}", caller);
        pushToast(msg);
        void playIncomingCallRing();
        window.dispatchEvent(
          new CustomEvent(
            isThreeCx ? "openconduit:threecx-call-incoming" : "openconduit:wavoip-call-incoming",
            { detail: data },
          ),
        );
      } else if (data.type === "wavoip.device.updated") {
        window.dispatchEvent(new CustomEvent("openconduit:wavoip-device-updated", { detail: data }));
      }
    };

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryAttempt = 0;
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

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, pushToast, locale]);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((x) => (
          <motion.div
            key={x.id}
            layout
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto rounded-lg border border-red-200 bg-white px-4 py-3 text-sm shadow-lg ring-2 ring-red-500/20 dark:border-red-900/40 dark:bg-ink-900"
          >
            <p className="font-medium text-red-800 dark:text-red-200">{t("workspace.transferTitle")}</p>
            <p className="mt-1 text-ink-600">{x.text}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
