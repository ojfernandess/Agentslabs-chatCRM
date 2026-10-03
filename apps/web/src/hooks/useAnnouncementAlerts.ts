import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export type AnnouncementAlertItem = {
  id: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  priority: string;
  category: { name: string; icon: string; tone: string };
};

export function useAnnouncementAlerts() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AnnouncementAlertItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ count: number; items: AnnouncementAlertItem[] }>("/announcements/inbox");
      setUnreadCount(data.count);
      setItems(data.items);
    } catch {
      /* o sino de conversas continua independente */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("openconduit:announcement-published", onChange);
    window.addEventListener("openconduit:announcement-read", onChange);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.removeEventListener("openconduit:announcement-published", onChange);
      window.removeEventListener("openconduit:announcement-read", onChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { unreadCount, items, refresh };
}
