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
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[110] flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div
          className={clsx(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            isConnected
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-amber-500/15 text-amber-300",
          )}
        >
          {isConnected ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" aria-hidden />
          ) : null}
          <PhoneCall className={clsx("relative h-5 w-5", isConnected && "animate-pulse")} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{peerLabel}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-bold tabular-nums text-emerald-400">
              {formatCallDuration(callElapsedSec)}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {statusLabel}
            </span>
            <span className="text-[10px] text-slate-500">· {t("wavoip.voice.incomingChannel")}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void endActiveCall()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md transition hover:bg-red-500 active:scale-[0.98]"
        >
          <PhoneOff className="h-4 w-4" />
          {t("wavoip.voice.hangUp")}
        </button>
      </div>
    </div>
  );
}
