import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { api } from "@/lib/api";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { isSuperAdminRole } from "@/lib/authRole";
import { useAuth } from "@/hooks/useAuth";
import {
  readAudioAlertOnlyWhenHiddenPref,
  readAudioAlertRepeatPref,
  readAudioAlertSoundPref,
} from "@/lib/profilePrefs";
import { playAudioAlert } from "@/lib/audioAlerts";
import { formatMessageBodyForPreview } from "@/lib/messagePreviewText";

const BELL_CLEARED_KEY = "openconduit_bell_cleared_at";
const POLL_MS = 22_000;
const SHOWN_CAP = 400;
const AUDIO_REPEAT_MS = 30_000;
const REALTIME_POLL_DEBOUNCE_MS = 350;

export interface ConversationNotificationPrefs {
  notifyConversationOpen: boolean;
  notifyConversationPending: boolean;
}

interface LastMessage {
  id: string;
  direction: string;
  body: string | null;
  type?: string;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  status: string;
  updatedAt: string;
  isUnread?: boolean;
  contact: { id: string; name: string; phone: string; profilePictureUrl?: string | null };
  messages: LastMessage[];
}

interface ConversationListResponse {
  data: ConversationRow[];
}

export interface ConversationAlertPreview {
  id: string;
  contactId: string;
  contactName: string;
  profilePictureUrl: string | null;
  preview: string;
  updatedAt: string;
}

function messagePreview(m: LastMessage | undefined): string {
  const text = formatMessageBodyForPreview(m?.body, { messageType: m?.type });
  return text || "New activity";
}

function qualifies(
  c: ConversationRow,
  prefs: ConversationNotificationPrefs,
): boolean {
  if (c.status === "OPEN" && prefs.notifyConversationOpen) return true;
  if (c.status === "PENDING" && prefs.notifyConversationPending) return true;
  return false;
}

function shouldShowInBell(
  c: ConversationRow,
  prefs: ConversationNotificationPrefs,
  clearedAt: number,
): boolean {
  if (!qualifies(c, prefs)) return false;
  const last = c.messages?.[0];
  if (!last || last.direction !== "INBOUND") return false;
  if (c.isUnread === false) return false;
  if (new Date(c.updatedAt).getTime() <= clearedAt) return false;
  return true;
}

function countBadge(
  rows: ConversationRow[],
  prefs: ConversationNotificationPrefs,
  clearedAt: number,
): number {
  let n = 0;
  for (const c of rows) {
    if (shouldShowInBell(c, prefs, clearedAt)) n++;
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
    if (!shouldShowInBell(c, prefs, clearedAt)) continue;
    const last = c.messages?.[0];
    if (!last) continue;
    out.push({
      id: c.id,
      contactId: c.contact.id,
      contactName: c.contact.name,
      profilePictureUrl: c.contact.profilePictureUrl ?? null,
      preview: messagePreview(last),
      updatedAt: c.updatedAt,
    });
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return out.slice(0, 20);
}

function getOpenConversationId(): string | null {
  const m = window.location.pathname.match(/\/conversations\/(?:c\/)?([^/]+)/);
  const id = m?.[1];
  if (!id || id === "c") return null;
  return id;
}

function applyReadToBellState(
  conversationId: string,
  setAlertPreviews: Dispatch<SetStateAction<ConversationAlertPreview[]>>,
  setBadgeCount: Dispatch<SetStateAction<number>>,
  badgeCountRef: MutableRefObject<number>,
): void {
  setAlertPreviews((prev) => {
    const had = prev.some((p) => p.id === conversationId);
    const next = prev.filter((p) => p.id !== conversationId);
    if (had) {
      setBadgeCount((count) => {
        const updated = Math.max(0, count - 1);
        badgeCountRef.current = updated;
        return updated;
      });
    }
    return next;
  });
}

export function useConversationAlerts() {
  const { user, loading: authLoading } = useAuth();
  const [badgeCount, setBadgeCount] = useState(0);
  const [alertPreviews, setAlertPreviews] = useState<ConversationAlertPreview[]>([]);
  const lastSinceRef = useRef<string>(new Date().toISOString());
  const shownKeysRef = useRef(new Set<string>());
  const badgeCountRef = useRef(0);
  const audioRepeatIdRef = useRef<number | null>(null);
  const pollDebounceRef = useRef<number | null>(null);

  const clearAudioRepeat = useCallback(() => {
    if (audioRepeatIdRef.current != null) window.clearInterval(audioRepeatIdRef.current);
    audioRepeatIdRef.current = null;
  }, []);

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
    const nextBadge = countBadge(full.data, prefs, clearedAt);
    badgeCountRef.current = nextBadge;
    setBadgeCount(nextBadge);
    setAlertPreviews(buildAlertPreviews(full.data, prefs, clearedAt));

    const openConversationId = getOpenConversationId();

    for (const c of delta.data) {
      if (!qualifies(c, prefs)) continue;
      const last = c.messages?.[0];
      if (!last || last.direction !== "INBOUND") continue;
      if (c.isUnread === false) continue;
      if (openConversationId && c.id === openConversationId) continue;

      const key = `${c.id}-${last.id}`;
      if (shownKeysRef.current.has(key)) continue;
      shownKeysRef.current.add(key);
      if (shownKeysRef.current.size > SHOWN_CAP) {
        const arr = [...shownKeysRef.current];
        shownKeysRef.current = new Set(arr.slice(-200));
      }

      const sound = readAudioAlertSoundPref();
      const onlyWhenHidden = readAudioAlertOnlyWhenHiddenPref();
      const repeat = readAudioAlertRepeatPref();
      const canPlayNow = !onlyWhenHidden || document.visibilityState !== "visible";
      if (sound !== "none" && canPlayNow) {
        void playAudioAlert(sound, 0.9);
        if (repeat && audioRepeatIdRef.current == null) {
          audioRepeatIdRef.current = window.setInterval(() => {
            const s = readAudioAlertSoundPref();
            const ow = readAudioAlertOnlyWhenHiddenPref();
            const ok = !ow || document.visibilityState !== "visible";
            if (!ok || s === "none") return;
            if (badgeCountRef.current <= 0) {
              clearAudioRepeat();
              return;
            }
            void playAudioAlert(s, 0.9);
          }, AUDIO_REPEAT_MS);
        }
      }

      if (typeof Notification === "undefined") continue;
      if (Notification.permission !== "granted") continue;

      try {
        const icon =
          notificationIconUrl(c.contact.profilePictureUrl ?? null) ??
          `${window.location.origin}${brandAssetUrl("/logo.svg")}`;
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
  }, [user, clearAudioRepeat]);

  const schedulePoll = useCallback(() => {
    if (pollDebounceRef.current != null) window.clearTimeout(pollDebounceRef.current);
    pollDebounceRef.current = window.setTimeout(() => {
      pollDebounceRef.current = null;
      void poll();
    }, REALTIME_POLL_DEBOUNCE_MS);
  }, [poll]);

  useEffect(() => {
    if (authLoading || !user) return;
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(id);
  }, [authLoading, user, poll]);

  useEffect(() => {
    const onRead = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (!conversationId) return;
      applyReadToBellState(conversationId, setAlertPreviews, setBadgeCount, badgeCountRef);
      if (badgeCountRef.current <= 0) clearAudioRepeat();
      schedulePoll();
    };
    const onUnread = () => {
      schedulePoll();
    };
    const onUpdated = () => {
      schedulePoll();
    };
    window.addEventListener("openconduit:conversation-read", onRead);
    window.addEventListener("openconduit:conversation-unread", onUnread);
    window.addEventListener("openconduit:conversation-updated", onUpdated);
    return () => {
      window.removeEventListener("openconduit:conversation-read", onRead);
      window.removeEventListener("openconduit:conversation-unread", onUnread);
      window.removeEventListener("openconduit:conversation-updated", onUpdated);
      if (pollDebounceRef.current != null) window.clearTimeout(pollDebounceRef.current);
    };
  }, [schedulePoll, clearAudioRepeat]);

  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") clearAudioRepeat();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [clearAudioRepeat]);

  const clearBadge = useCallback(() => {
    localStorage.setItem(BELL_CLEARED_KEY, new Date().toISOString());
    badgeCountRef.current = 0;
    setBadgeCount(0);
    setAlertPreviews([]);
    clearAudioRepeat();
  }, [clearAudioRepeat]);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const p = await Notification.requestPermission();
    return p === "granted";
  }, []);

  return { badgeCount, alertPreviews, clearBadge, requestDesktopPermission };
}
