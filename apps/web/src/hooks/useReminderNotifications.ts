import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

type ReminderNotificationRow = {
  id: string;
  note: string;
  dueAt: string;
  contact?: { id: string; name: string | null; phone: string | null } | null;
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

function shouldNotify(reminderId: string, dueAtIso: string): boolean {
  const k = `openconduit_reminder_notified:${reminderId}`;
  const prev = safeGet(k);
  if (prev === dueAtIso) return false;
  safeSet(k, dueAtIso);
  return true;
}

function buildNotificationBody(row: ReminderNotificationRow): string {
  const contactName = row.contact?.name?.trim() || row.contact?.phone?.trim() || "—";
  const due = new Date(row.dueAt);
  const when = Number.isNaN(due.getTime()) ? "" : due.toLocaleString();
  return `${contactName}${when ? `\n${when}` : ""}`;
}

export function useReminderNotifications(enabled: boolean) {
  const navigate = useNavigate();
  const pollInFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof Notification === "undefined") return;

    const key = "openconduit_reminders_last_poll";

    const poll = async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const now = new Date();
        const lastRaw = safeGet(key);
        const last = lastRaw ? new Date(lastRaw) : new Date(now.getTime() - 60_000);
        const from = new Date(Math.max(0, last.getTime() - 20_000));
        const to = new Date(now.getTime() + 15_000);

        safeSet(key, now.toISOString());

        const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
        const rows = await api.get<ReminderNotificationRow[]>(`/reminders/notification-due?${params}`);
        if (!Array.isArray(rows) || rows.length === 0) return;

        for (const row of rows) {
          if (!row?.id || !row?.dueAt || !row.note) continue;
          if (Notification.permission !== "granted") continue;
          if (!shouldNotify(row.id, row.dueAt)) continue;

          const url = `/reminders?open=${encodeURIComponent(row.id)}`;
          const title = row.note.length > 42 ? `${row.note.slice(0, 42).trim()}…` : row.note;
          const notification = new Notification(title || "Lembrete", {
            body: buildNotificationBody(row),
            tag: `reminder:${row.id}`,
            data: { url },
          } as NotificationOptions);

          notification.onclick = (e) => {
            e.preventDefault();
            try {
              window.focus();
            } catch {
            }
            navigate(url);
            notification.close();
          };
        }
      } catch {
      } finally {
        pollInFlight.current = false;
      }
    };

    const tick = () => void poll();
    tick();
    const interval = window.setInterval(tick, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, navigate]);
}

