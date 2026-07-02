import clsx from "clsx";
import {
  INBOX_CHANNEL_ICONS,
  INBOX_CHANNEL_STYLES,
  isInboxChannelId,
  type InboxChannelId,
} from "@/lib/inboxChannelUi";
import { MessageSquare } from "lucide-react";

type Props = {
  channelType: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE = {
  sm: { box: "h-9 w-9", icon: "h-4 w-4" },
  md: { box: "h-11 w-11", icon: "h-5 w-5" },
  lg: { box: "h-14 w-14", icon: "h-7 w-7" },
};

/** Ícones de marca com fill próprio no SVG — forçar branco sobre o tile colorido. */
const BRAND_GLYPH_CHANNELS = new Set<InboxChannelId>(["WHATSAPP", "INSTAGRAM", "TELEGRAM"]);

export function InboxChannelIcon({ channelType, size = "md", className }: Props) {
  const id = isInboxChannelId(channelType) ? channelType : null;
  const styles = id ? INBOX_CHANNEL_STYLES[id] : null;
  const Icon = id ? INBOX_CHANNEL_ICONS[id as InboxChannelId] : MessageSquare;
  const s = SIZE[size];
  const brandGlyphOnSolid = id != null && BRAND_GLYPH_CHANNELS.has(id);

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-2xl text-white shadow-sm ring-2",
        s.box,
        styles?.bg ?? "bg-slate-500",
        styles?.ring ?? "ring-slate-200",
        className,
      )}
    >
      <Icon
        className={clsx(
          s.icon,
          "relative z-[1]",
          brandGlyphOnSolid
            ? "[&_path]:!fill-white [&_circle]:!fill-white"
            : "text-white",
        )}
      />
    </div>
  );
}
