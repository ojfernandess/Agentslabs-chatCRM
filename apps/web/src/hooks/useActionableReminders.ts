import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

export type ActionableReminder = {
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
    /* ignore */
  }
}

function todayLocalYmd(): string {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function shouldNotifyAtDueTime(reminderId: string, dueAtIso: string): boolean {
  const k = `openconduit_reminder_notified:${reminderId}`;
  if (safeGet(k) === dueAtIso) return false;
  safeSet(k, dueAtIso);
  return true;
}

function shouldSendOverdueDailyPing(reminderId: string): boolean {
  const today = todayLocalYmd();
  const k = `openconduit_reminder_overdue_ping:${reminderId}`;
  if (safeGet(k) === today) return false;
  safeSet(k, today);
  return true;
}

function buildNotificationBody(row: ActionableReminder): string {
  const contactName = row.contact?.name?.trim() || row.contact?.phone?.trim() || "—";
  const due = new Date(row.dueAt);
  const when = Number.isNaN(due.getTime()) ? "" : due.toLocaleString();
  return `${contactName}${when ? `\n${when}` : ""}`;
}

function dispatchRemindersUpdated() {
  window.dispatchEvent(new CustomEvent("openconduit:reminders-updated"));
}

function pushBrowserNotifications(rows: ActionableReminder[], navigate: (url: string) => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  const now = Date.now();

  for (const row of rows) {
    if (!row?.id || !row?.dueAt || !row.note) continue;
    const dueMs = new Date(row.dueAt).getTime();
    if (Number.isNaN(dueMs) || dueMs > now) continue;

    const dueNotified = safeGet(`openconduit_reminder_notified:${row.id}`) === row.dueAt;
    const shouldNotify = dueNotified ? shouldSendOverdueDailyPing(row.id) : shouldNotifyAtDueTime(row.id, row.dueAt);
    if (!shouldNotify) continue;

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
        /* ignore */
      }
      navigate(url);
      notification.close();
    };
  }
}

export function useActionableReminders(enabled: boolean) {
  const navigate = useNavigate();
  const [reminders, setReminders] = useState<ActionableReminder[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const pollInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setReminders([]);
      return;
    }
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const rows = await api.get<ActionableReminder[]>("/reminders/actionable");
      const list = Array.isArray(rows) ? rows : [];
      setReminders(list);
      pushBrowserNotifications(list, navigate);
    } catch {
      /* ignore */
    } finally {
      pollInFlight.current = false;
    }
  }, [enabled, navigate]);

  useEffect(() => {
    if (!enabled) return;

    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onUpdated = () => void refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("openconduit:reminders-updated", onUpdated);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("openconduit:reminders-updated", onUpdated);
    };
  }, [enabled, refresh]);

  const completeReminder = useCallback(
    async (id: string) => {
      setCompletingId(id);
      try {
        await api.put(`/reminders/${id}`, { completed: true, status: "DONE" });
        dispatchRemindersUpdated();
        await refresh();
      } catch {
        /* ignore */
      } finally {
        setCompletingId(null);
      }
    },
    [refresh],
  );

  return { reminders, completingId, completeReminder, refresh };
}

export { dispatchRemindersUpdated };
