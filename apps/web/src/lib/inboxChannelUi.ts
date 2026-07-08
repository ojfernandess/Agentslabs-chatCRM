import type { ComponentType } from "react";
import {
  Code2,
  Globe,
  Mail,
  MessageSquare,
  PanelTop,
  Phone,
  Share2,
  Smartphone,
} from "lucide-react";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { InstagramBrandIcon } from "@/components/InstagramBrandIcon";
import { TelegramBrandIcon } from "@/components/TelegramBrandIcon";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

/** Ordem alinhada à UX do Chatwoot (add inbox). */
export const INBOX_CHANNEL_ORDER = [
  "WEBSITE",
  "FACEBOOK",
  "WHATSAPP",
  "SMS",
  "EMAIL",
  "API",
  "TELEGRAM",
  "LINE",
  "INSTAGRAM",
  "VOICE",
] as const;

export type InboxChannelId = (typeof INBOX_CHANNEL_ORDER)[number];
import {
  isInboxEmailConfigured,
  parseInboxEmailFromChannelConfig,
} from "@/lib/inboxEmailConfig";
import {
  isInboxWhatsappConfigured,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";

export const INBOX_CHANNEL_ICONS: Record<InboxChannelId, ComponentType<{ className?: string }>> = {
  WEBSITE: PanelTop,
  FACEBOOK: Share2,
  WHATSAPP: WhatsAppBrandIcon,
  SMS: Smartphone,
  EMAIL: Mail,
  API: Code2,
  TELEGRAM: TelegramBrandIcon,
  LINE: Globe,
  INSTAGRAM: InstagramBrandIcon,
  VOICE: Phone,
};

export const INBOX_CHANNEL_STYLES: Record<
  InboxChannelId,
  { ring: string; bg: string; text: string; badge: string }
> = {
  WEBSITE: {
    ring: "ring-violet-200 dark:ring-violet-900/50",
    bg: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  },
  FACEBOOK: {
    ring: "ring-blue-200 dark:ring-blue-900/50",
    bg: "bg-blue-600",
    text: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  },
  WHATSAPP: {
    ring: "ring-emerald-200 dark:ring-emerald-900/50",
    bg: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  },
  SMS: {
    ring: "ring-sky-200 dark:ring-sky-900/50",
    bg: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  },
  EMAIL: {
    ring: "ring-violet-200 dark:ring-violet-900/50",
    bg: "bg-brand-500",
    text: "text-brand-700 dark:text-brand-300",
    badge: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200",
  },
  API: {
    ring: "ring-slate-200 dark:ring-slate-700",
    bg: "bg-slate-600",
    text: "text-slate-700 dark:text-slate-300",
    badge: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  },
  TELEGRAM: {
    ring: "ring-cyan-200 dark:ring-cyan-900/50",
    bg: "bg-cyan-500",
    text: "text-cyan-700 dark:text-cyan-300",
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200",
  },
  LINE: {
    ring: "ring-lime-200 dark:ring-lime-900/50",
    bg: "bg-lime-600",
    text: "text-lime-800 dark:text-lime-200",
    badge: "bg-lime-100 text-lime-900 dark:bg-lime-950/50 dark:text-lime-200",
  },
  INSTAGRAM: {
    ring: "ring-pink-200 dark:ring-pink-900/50",
    bg: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400",
    text: "text-pink-700 dark:text-pink-300",
    badge: "bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-200",
  },
  VOICE: {
    ring: "ring-indigo-200 dark:ring-indigo-900/50",
    bg: "bg-indigo-500",
    text: "text-indigo-700 dark:text-indigo-300",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  },
};

export function isInboxChannelId(v: string): v is InboxChannelId {
  return (INBOX_CHANNEL_ORDER as readonly string[]).includes(v);
}

export function inboxConnectionLabel(
  channelType: string,
  channelConfig: unknown,
  whatsappConfigured?: boolean,
): string | null {
  if (channelType === "WHATSAPP") {
    const wa = parseInboxWhatsappFromChannelConfig(channelConfig);
    const ok = whatsappConfigured ?? isInboxWhatsappConfigured(wa);
    if (!ok) return null;
    return whatsappProviderLabel(wa.whatsappProvider);
  }
  if (channelType === "WEBSITE") return "Widget";
  if (channelType === "TELEGRAM") return "Bot API";
  if (channelType === "FACEBOOK" || channelType === "INSTAGRAM") return "Meta Graph";
  if (channelType === "LINE") return "Messaging API";
  if (channelType === "SMS" || channelType === "VOICE") return "Twilio";
  if (channelType === "EMAIL") return "SMTP / IMAP";
  if (channelType === "API") return "Client API";
  return null;
}

export function inboxIsChannelReady(
  channelType: string,
  channelConfig: unknown,
  ingestToken?: string | null,
  whatsappConfigured?: boolean,
): boolean {
  if (channelType === "WHATSAPP") {
    const wa = parseInboxWhatsappFromChannelConfig(channelConfig);
    return whatsappConfigured ?? isInboxWhatsappConfigured(wa);
  }
  if (channelType === "EMAIL") {
    return isInboxEmailConfigured(parseInboxEmailFromChannelConfig(channelConfig));
  }
  return Boolean(ingestToken);
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatInboxDate(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(iso),
    );
  } catch {
    return "—";
  }
}

export function relativeActivityBars(conversationCount: number, maxCount: number): number[] {
  if (maxCount <= 0) return [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
  const ratio = Math.min(1, conversationCount / maxCount);
  const seed = conversationCount * 7 + 3;
  return Array.from({ length: 7 }, (_, i) => {
    const wobble = ((seed + i * 11) % 17) / 34;
    return Math.max(0.15, Math.min(1, ratio * (0.55 + wobble)));
  });
}
