import { useState } from "react";
import { Loader2, Phone } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useWavoipVoiceOptional } from "@/contexts/WavoipVoiceContext";

type Props = {
  phone: string | null | undefined;
  inboxId?: string | null;
  className?: string;
  compact?: boolean;
};

export function WavoipCallButton({ phone, inboxId, className, compact }: Props) {
  const { t } = useI18n();
  const voice = useWavoipVoiceOptional();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!voice?.ready || voice.devices.length === 0 || !phone?.trim()) return null;
  if (voice.activeCall) return null;

  const dial = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await voice.startOutboundCall({ phone: phone.trim(), inboxId });
      if (!res.ok) {
        setError(res.message === "no_devices" ? t("wavoip.voice.noDevices") : res.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={clsx("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        disabled={loading}
        onClick={() => void dial()}
        title={t("wavoip.voice.callTooltip")}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60",
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
        {compact ? null : t("wavoip.voice.callButton")}
      </button>
      {error ? <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
