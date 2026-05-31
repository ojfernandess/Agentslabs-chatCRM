import { PhoneCall, PhoneOff } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCallDuration } from "@/lib/callDuration";
import { useWavoipVoice } from "@/contexts/WavoipVoiceContext";

export function WavoipActiveCallBar() {
  const { t } = useI18n();
  const { activeCall, callStatus, callElapsedSec, endActiveCall } = useWavoipVoice();

  if (!activeCall) return null;

  const peerLabel =
    activeCall.peer.displayName?.trim() ||
    activeCall.peer.phone ||
    t("wavoip.voice.unknownCaller");

  const statusKey = (callStatus ?? activeCall.status ?? "ACTIVE").toUpperCase();
  const knownStatuses = [
    "RINGING",
    "CALLING",
    "NOT_ANSWERED",
    "ACTIVE",
    "ENDED",
    "REJECTED",
    "FAILED",
    "DISCONNECTED",
  ] as const;
  const statusLabel = knownStatuses.includes(statusKey as (typeof knownStatuses)[number])
    ? t(`wavoip.voice.callStatus.${statusKey}`)
    : statusKey;
  const isConnected = statusKey === "ACTIVE";

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[110] w-[min(100vw-2rem,22rem)]">
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-red-500/20 bg-white shadow-2xl shadow-red-500/10 dark:border-red-400/15 dark:bg-ink-950">
        <div className="flex items-stretch">
          <div className="flex w-1.5 shrink-0 bg-gradient-to-b from-red-500 to-red-700" aria-hidden />
          <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
            <div
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                isConnected
                  ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                  : "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
              )}
            >
              <PhoneCall className={clsx("h-5 w-5", isConnected && "animate-pulse")} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-ink-50">{peerLabel}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-sm font-bold tabular-nums tracking-tight text-red-600 dark:text-red-400">
                  {formatCallDuration(callElapsedSec)}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ink-400">
                  {statusLabel}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void endActiveCall()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
            >
              <PhoneOff className="h-4 w-4" />
              {t("wavoip.voice.hangUp")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
