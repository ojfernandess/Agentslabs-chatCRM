import { clsx } from "clsx";
import {
  CONNECTION_STATE_LABELS,
  type WhatsappConnectionUiState,
} from "@/lib/whatsappConnectionUiState";

interface Props {
  state: WhatsappConnectionUiState;
  locale?: "pt" | "en";
  size?: "sm" | "md";
  className?: string;
}

const toneClasses: Record<
  (typeof CONNECTION_STATE_LABELS)[WhatsappConnectionUiState]["tone"],
  string
> = {
  neutral:
    "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300",
  success:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  danger:
    "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  info:
    "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

export function WhatsappConnectionStatusBadge({
  state,
  locale = "pt",
  size = "sm",
  className,
}: Props) {
  const meta = CONNECTION_STATE_LABELS[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        toneClasses[meta.tone],
        className,
      )}
    >
      <span
        className={clsx(
          "rounded-full",
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
          state === "connected"
            ? "bg-emerald-500"
            : state === "connecting"
              ? "bg-sky-500 animate-pulse"
              : state === "error"
                ? "bg-red-500"
                : state === "configured_disconnected"
                  ? "bg-amber-500"
                  : "bg-ink-400",
        )}
        aria-hidden
      />
      {locale === "en" ? meta.en : meta.pt}
    </span>
  );
}
