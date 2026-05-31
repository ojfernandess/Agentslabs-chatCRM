import { PhoneCall } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCallDuration } from "@/lib/callDuration";
import { useWavoipVoiceOptional } from "@/contexts/WavoipVoiceContext";

type Props = {
  conversationId?: string | null;
  className?: string;
};

export function WavoipConversationOnCallBadge({ conversationId, className }: Props) {
  const { t } = useI18n();
  const voice = useWavoipVoiceOptional();

  if (!voice?.activeCall || !conversationId) return null;
  if (!voice.isOnCallForConversation(conversationId)) return null;

  const statusKey = (voice.callStatus ?? "ACTIVE").toUpperCase();
  const statusLabel =
    t(`wavoip.voice.callStatus.${statusKey}`) !== `wavoip.voice.callStatus.${statusKey}`
      ? t(`wavoip.voice.callStatus.${statusKey}`)
      : t("wavoip.voice.onCall");

  return (
    <span
      className={
        className ??
        "inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-gradient-to-r from-red-500/10 to-red-600/5 px-3 py-1 shadow-sm shadow-red-500/10 dark:border-red-400/20 dark:from-red-950/60 dark:to-red-900/30 dark:shadow-red-950/40"
      }
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <PhoneCall className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      <span className="font-mono text-xs font-bold tabular-nums tracking-tight text-red-700 dark:text-red-300">
        {formatCallDuration(voice.callElapsedSec)}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600/90 dark:text-red-300/90">
        {statusLabel}
      </span>
    </span>
  );
}
