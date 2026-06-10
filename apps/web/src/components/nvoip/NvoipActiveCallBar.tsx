import { PhoneOff } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";

export function NvoipActiveCallBar() {
  const { t } = useI18n();
  const voice = useNvoipVoiceOptional();
  const call = voice?.activeCall;
  if (!call) return null;

  const effectiveStatus =
    call.status === "CALLING_ORIGIN" && call.elapsedSec >= 5
      ? "CALLING_DESTINATION"
      : call.status === "CALLING_DESTINATION" && call.elapsedSec >= 18
        ? "ACTIVE"
        : call.status;
  const statusKey = `nvoip.voice.callStatus.${effectiveStatus}`;
  const statusLabel = t(statusKey) === statusKey ? effectiveStatus : t(statusKey);
  const statusHint =
    effectiveStatus === "CALLING_ORIGIN"
      ? t("nvoip.voice.hintCallingOrigin")
      : effectiveStatus === "CALLING_DESTINATION"
        ? t("nvoip.voice.hintCallingDestination")
        : effectiveStatus === "ACTIVE"
          ? t("nvoip.voice.hintActive")
          : null;
  const mm = Math.floor(call.elapsedSec / 60);
  const ss = String(call.elapsedSec % 60).padStart(2, "0");

  return (
    <div className="fixed bottom-4 left-1/2 z-[115] max-w-md -translate-x-1/2 rounded-2xl border border-orange-500/30 bg-slate-900/95 px-4 py-2.5 text-sm text-white shadow-xl backdrop-blur-md">
      <div className="flex flex-col items-center gap-1">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="font-medium">{t("nvoip.voice.activeCall")}</span>
          <span className="text-orange-300">
            {statusLabel} · {mm}:{ss}
          </span>
          {call.dialPhone ? <span className="text-xs text-slate-300">→ {call.dialPhone}</span> : null}
          <button
            type="button"
            onClick={() => void voice?.endActiveCall()}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600/90 px-2.5 py-1 text-xs font-semibold hover:bg-red-500"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            {t("nvoip.voice.hangUp")}
          </button>
        </div>
        {statusHint ? <p className="text-center text-[11px] text-slate-300">{statusHint}</p> : null}
      </div>
    </div>
  );
}
