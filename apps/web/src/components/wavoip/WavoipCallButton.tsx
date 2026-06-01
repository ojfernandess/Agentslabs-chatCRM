import { useState } from "react";
import { Loader2, Phone, PhoneCall } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { formatCallDuration } from "@/lib/callDuration";
import { useWavoipVoiceOptional } from "@/contexts/WavoipVoiceContext";

type Props = {
  phone: string | null | undefined;
  inboxId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  stopPropagation?: boolean;
};

export function WavoipCallButton({
  phone,
  inboxId,
  conversationId,
  contactId,
  className,
  compact,
  iconOnly,
  stopPropagation,
}: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const voice = useWavoipVoiceOptional();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wavoipEnabled = user?.organizationFeatures?.wavoip_voice ?? false;

  if (!phone?.trim() || !wavoipEnabled || !voice) return null;

  const onThisConversation =
    !!conversationId && voice.isOnCallForConversation(conversationId);

  const dial = async (e?: React.MouseEvent) => {
    if (stopPropagation) {
      e?.preventDefault();
      e?.stopPropagation();
    }
    setLoading(true);
    setError(null);
    try {
      const res = await voice.startOutboundCall({
        phone: phone.trim(),
        inboxId,
        conversationId,
        contactId,
      });
      if (!res.ok) {
        setError(res.message === "no_devices" ? t("wavoip.voice.noDevices") : res.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (onThisConversation) {
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 font-semibold text-red-700 shadow-sm shadow-red-500/10 dark:border-red-400/25 dark:bg-red-950/50 dark:text-red-300",
          iconOnly || compact ? "h-8 min-w-8 px-1.5" : "px-2.5 py-2 text-xs",
          className,
        )}
        title={t("wavoip.voice.onCall")}
        aria-label={t("wavoip.voice.onCall")}
        role="status"
      >
        <PhoneCall className="h-4 w-4 shrink-0 animate-pulse text-red-600 dark:text-red-400" />
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {formatCallDuration(voice.callElapsedSec)}
        </span>
      </span>
    );
  }

  if (!voice.canPlaceCalls) return null;

  if (voice.activeCall && !iconOnly) return null;

  return (
    <div className={clsx("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        disabled={loading || !!voice.activeCall}
        onClick={(e) => void dial(e)}
        title={t("wavoip.voice.callTooltip")}
        aria-label={t("wavoip.voice.callTooltip")}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60",
          iconOnly || compact ? "h-8 w-8 p-0" : "px-3 py-2 text-sm",
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
        {!iconOnly && !compact ? t("wavoip.voice.callButton") : null}
      </button>
      {error ? <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
