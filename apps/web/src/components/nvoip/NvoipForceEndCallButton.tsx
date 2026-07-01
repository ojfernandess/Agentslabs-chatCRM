import { useState } from "react";
import { PhoneOff } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import type { ActiveVoiceCall } from "@/lib/activeVoiceCall";

type Props = {
  conversationId: string;
  activeVoiceCall?: ActiveVoiceCall | null;
  className?: string;
  compact?: boolean;
};

export function NvoipForceEndCallButton({
  conversationId,
  activeVoiceCall,
  className,
  compact = false,
}: Props) {
  const { t } = useI18n();
  const voice = useNvoipVoiceOptional();
  const [busy, setBusy] = useState(false);

  if (!voice || activeVoiceCall?.provider !== "nvoip") return null;

  const onLocalCall = voice.isOnCallForConversation(conversationId);
  const showStale = !onLocalCall;

  if (!onLocalCall && !activeVoiceCall) return null;

  const handleClick = async () => {
    setBusy(true);
    try {
      await voice.forceEndConversationCall(conversationId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handleClick()}
      title={showStale ? t("nvoip.voice.forceEndCallHelp") : t("nvoip.voice.hangUp")}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border border-red-500/35 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-500/20 disabled:opacity-50 dark:border-red-400/30 dark:text-red-200",
        compact ? "px-1.5" : "px-2.5",
        className,
      )}
    >
      <PhoneOff className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t("nvoip.voice.forceEndCall")}</span>
    </button>
  );
}
