import { Headset, PhoneCall } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import type { ActiveVoiceCall } from "@/lib/activeVoiceCall";

type Props = {
  activeVoiceCall: ActiveVoiceCall | null | undefined;
  className?: string;
};

export function ConversationVoiceCallListBadge({ activeVoiceCall, className }: Props) {
  const { t } = useI18n();
  if (!activeVoiceCall) return null;
  if (!activeVoiceCall.agent?.id) return null;

  const agentName = activeVoiceCall.agent.name.trim();
  const inCallLabel = t("conversations.voiceCallInProgress");
  const label = agentName ? `${agentName} · ${inCallLabel}` : inCallLabel;

  return (
    <span
      className={clsx(
        "inline-flex max-w-[18rem] items-center gap-1.5 truncate rounded-full border border-red-500/30 bg-gradient-to-r from-red-500/12 to-rose-500/8 px-2.5 py-0.5 text-[11px] font-semibold text-red-800 shadow-sm shadow-red-500/10 dark:border-red-400/25 dark:from-red-950/70 dark:to-rose-950/40 dark:text-red-100",
        className,
      )}
      role="status"
      aria-live="polite"
      title={label}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-80" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500 dark:bg-red-400" />
      </span>
      {agentName ? (
        <Headset className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
      ) : (
        <PhoneCall className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}
