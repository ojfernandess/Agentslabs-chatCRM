import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isSuperAdminRole } from "@/lib/authRole";
import { useAuth } from "@/hooks/useAuth";

const BELL_CLEARED_KEY = "openconduit_bell_cleared_at";
const POLL_MS = 22_000;
const SHOWN_CAP = 400;

export interface ConversationNotificationPrefs {
  notifyConversationOpen: boolean;
  notifyConversationPending: boolean;
}

interface LastMessage {
  id: string;
  direction: string;
  body: string | null;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  status: string;
  updatedAt: string;
  contact: { name: string; phone: string; profilePictureUrl?: string | null };
  messages: LastMessage[];
}

interface ConversationListResponse {
  data: ConversationRow[];
}

export interface ConversationAlertPreview {
  id: string;
  contactName: string;
  profilePictureUrl: string | null;
  preview: string;
  updatedAt: string;
}

function messagePreview(m: LastMessage | undefined): string {
  if (!m?.body) return "New activity";
  const t = m.body.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function qualifies(
  c: ConversationRow,
  prefs: ConversationNotificationPrefs,
): boolean {
  if (c.status === "OPEN" && prefs.notifyConversationOpen) return true;
  if (c.status === "PENDING" && prefs.notifyConversationPending) return true;
  return false;
}

function countBadge(
  rows: ConversationRow[],
  prefs: ConversationNotificationPrefs,
  clearedAt: number,
): number {
  let n = 0;
  for (const c of rows) {
    if (!qualifies(c, prefs)) continue;
    const last = c.messages[0];
    if (!last || last.direction !== "INBOUND") continue;
    if (new Date(c.updatedAt).getTime() > clearedAt) n++;
  }
  return n;
}

function notificationIconUrl(profileUrl: string | null | undefined): string | undefined {
  if (!profileUrl || !profileUrl.trim()) return undefined;
  if (/^https?:\/\//i.test(profileUrl)) return profileUrl;
  try {
    return new URL(profileUrl, window.location.origin).href;
  } catch {
    return undefined;
  }
}

function buildAlertPreviews(
  rows: ConversationRow[],
  prefs: ConversationNotificationPrefs,
  clearedAt: number,
): ConversationAlertPreview[] {
  const out: ConversationAlertPreview[] = [];
  for (const c of rows) {
    if (!qualifies(c, prefs)) continue;
    const last = c.messages[0];
    if (!last || last.direction !== "INBOUND") continue;
    if (new Date(c.updatedAt).getTime() <= clearedAt) continue;
    out.push({
      id: c.id,
      contactName: c.contact.name,
      profilePictureUrl: c.contact.profilePictureUrl ?? null,
      preview: messagePreview(last),
      updatedAt: c.updatedAt,
    });
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return out.slice(0, 20);
}

export function useConversationAlerts() {
  const { user, loading: authLoading } = useAuth();
  const [badgeCount, setBadgeCount] = useState(0);
  const [alertPreviews, setAlertPreviews] = useState<ConversationAlertPreview[]>([]);
  const lastSinceRef = useRef<string>(new Date().toISOString());
  const shownKeysRef = useRef(new Set<string>());

  const poll = useCallback(async () => {
    if (!user || (isSuperAdminRole(user.role) && !user.actingOrganizationId)) return;

    let prefs: ConversationNotificationPrefs;
    try {
      prefs = await api.get<ConversationNotificationPrefs>("/settings/notifications");
    } catch {
      return;
    }

    if (!prefs.notifyConversationOpen && !prefs.notifyConversationPending) {
      setBadgeCount(0);
      setAlertPreviews([]);
      lastSinceRef.current = new Date().toISOString();
      return;
    }

    const since = lastSinceRef.current;
    const nowIso = new Date().toISOString();

    let full: ConversationListResponse;
    let delta: ConversationListResponse;
    try {
      [full, delta] = await Promise.all([
        api.get<ConversationListResponse>("/conversations?pageSize=100"),
        api.get<ConversationListResponse>(
          `/conversations?since=${encodeURIComponent(since)}&pageSize=100`,
        ),
      ]);
    } catch {
      return;
    }

    lastSinceRef.current = nowIso;

    const clearedRaw = localStorage.getItem(BELL_CLEARED_KEY);
    const clearedAt = clearedRaw ? new Date(clearedRaw).getTime() : 0;
    setBadgeCount(countBadge(full.data, prefs, clearedAt));
    setAlertPreviews(buildAlertPreviews(full.data, prefs, clearedAt));

    for (const c of delta.data) {
      if (!qualifies(c, prefs)) continue;
      const last = c.messages[0];
      if (!last || last.direction !== "INBOUND") continue;

      const key = `${c.id}-${last.id}`;
      if (shownKeysRef.current.has(key)) continue;
      shownKeysRef.current.add(key);
      if (shownKeysRef.current.size > SHOWN_CAP) {
        const arr = [...shownKeysRef.current];
        shownKeysRef.current = new Set(arr.slice(-200));
      }

      if (typeof Notification === "undefined") continue;
      if (Notification.permission !== "granted") continue;

      try {
        const icon =
          notificationIconUrl(c.contact.profilePictureUrl ?? null) ?? `${window.location.origin}/logo.svg`;
        const n = new Notification(`${c.contact.name}`, {
          body: messagePreview(last),
          tag: key,
          icon,
        });
        n.onclick = () => {
          n.close();
          window.focus();
          window.location.assign(`/conversations/${c.id}`);
        };
      } catch {
        // ignore
      }
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(id);
  }, [authLoading, user, poll]);

  const clearBadge = useCallback(() => {
    localStorage.setItem(BELL_CLEARED_KEY, new Date().toISOString());
    setBadgeCount(0);
    setAlertPreviews([]);
  }, []);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const p = await Notification.requestPermission();
    return p === "granted";
  }, []);

  return { badgeCount, alertPreviews, clearBadge, requestDesktopPermission };
}
