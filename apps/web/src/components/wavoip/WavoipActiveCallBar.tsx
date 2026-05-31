import { PhoneOff } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useWavoipVoice } from "@/contexts/WavoipVoiceContext";

export function WavoipActiveCallBar() {
  const { t } = useI18n();
  const { activeCall, callStatus, endActiveCall } = useWavoipVoice();

  if (!activeCall) return null;

  const peerLabel =
    activeCall.peer.displayName?.trim() ||
    activeCall.peer.phone ||
    t("wavoip.voice.unknownCaller");

  const statusKey = callStatus ?? activeCall.status;
  const knownStatuses = ["RINGING", "CALLING", "NOT_ANSWERED", "ACTIVE", "ENDED", "REJECTED", "FAILED", "DISCONNECTED"] as const;
  const statusLabel = knownStatuses.includes(statusKey as (typeof knownStatuses)[number])
    ? t(`wavoip.voice.callStatus.${statusKey}`)
    : statusKey;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[110] max-w-sm">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 shadow-lg dark:border-brand-900/40 dark:bg-ink-900">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-ink-50">{peerLabel}</p>
          <p className={clsx("text-xs", statusKey === "ACTIVE" ? "text-emerald-600" : "text-slate-500 dark:text-ink-400")}>
            {statusLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void endActiveCall()}
          className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
        >
          <PhoneOff className="h-3.5 w-3.5" />
          {t("wavoip.voice.hangUp")}
        </button>
      </div>
    </div>
  );
}
