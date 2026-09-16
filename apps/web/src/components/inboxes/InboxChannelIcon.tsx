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

/** Marca com cores próprias no SVG (logo completo) — não aplicar fill branco. */
const FULL_COLOR_BRAND_CHANNELS = new Set<InboxChannelId>(["TELEGRAM", "INSTAGRAM"]);

/** Glifo monocromático sobre tile colorido (ex.: WhatsApp). */
const MONO_GLYPH_ON_SOLID = new Set<InboxChannelId>(["WHATSAPP"]);

export function InboxChannelIcon({ channelType, size = "md", className }: Props) {
  const id = isInboxChannelId(channelType) ? channelType : null;
  const styles = id ? INBOX_CHANNEL_STYLES[id] : null;
  const Icon = id ? INBOX_CHANNEL_ICONS[id as InboxChannelId] : MessageSquare;
  const s = SIZE[size];
  const fullColorBrand = id != null && FULL_COLOR_BRAND_CHANNELS.has(id);
  const monoGlyphOnSolid = id != null && MONO_GLYPH_ON_SOLID.has(id);

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center",
        s.box,
        fullColorBrand
          ? id === "TELEGRAM"
            ? "p-0 leading-none"
            : "overflow-hidden rounded-2xl p-0 leading-none shadow-sm"
          : clsx("rounded-2xl text-white shadow-sm ring-2", styles?.bg ?? "bg-slate-500", styles?.ring ?? "ring-slate-200"),
        className,
      )}
    >
      <Icon
        className={clsx(
          fullColorBrand
            ? clsx(
                "block h-full w-full shrink-0",
                id === "TELEGRAM" ? "rounded-[22%]" : "",
              )
            : s.icon,
          "relative z-[1]",
          monoGlyphOnSolid ? "[&_path]:!fill-white [&_circle]:!fill-white" : fullColorBrand ? "" : "text-white",
        )}
      />
    </div>
  );
}

/** Ícone no grid de seleção de canal (wizard Caixas de entrada). */
export function InboxChannelPickerIcon({ channel }: { channel: InboxChannelId }) {
  const Icon = INBOX_CHANNEL_ICONS[channel];
  if (channel === "TELEGRAM") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center leading-none">
        <Icon className="block h-10 w-10 shrink-0 rounded-[22%]" />
      </div>
    );
  }
  if (channel === "WHATSAPP") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
        <Icon className="h-6 w-6" />
      </div>
    );
  }
  if (channel === "INSTAGRAM") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <Icon className="h-10 w-10" />
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
      <Icon className="h-5 w-5" />
    </div>
  );
}
