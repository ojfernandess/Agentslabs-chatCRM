import { PhoneCall } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
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
        "inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
      }
    >
      <PhoneCall className="h-3.5 w-3.5 animate-pulse" aria-hidden />
      {statusLabel}
    </span>
  );
}
