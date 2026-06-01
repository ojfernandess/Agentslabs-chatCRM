import { useState } from "react";
import { Loader2, Phone } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { useThreeCxVoiceOptional } from "@/contexts/ThreeCxVoiceContext";

type Props = {
  phone: string | null | undefined;
  conversationId?: string | null;
  contactId?: string | null;
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  stopPropagation?: boolean;
};

export function ThreeCxCallButton({
  phone,
  conversationId,
  contactId,
  className,
  compact,
  iconOnly,
  stopPropagation,
}: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const voice = useThreeCxVoiceOptional();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = user?.organizationFeatures?.threecx_voice ?? false;

  if (!phone?.trim() || !enabled || !voice?.canPlaceCalls) return null;

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
        contactId,
        conversationId,
      });
      if (!res.ok) {
        setError(
          res.message === "no_route_points"
            ? t("threecx.voice.noRoutePoints")
            : res.message,
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={(e) => void dial(e)}
        disabled={loading}
        title={t("threecx.call.tooltip")}
        aria-label={t("threecx.call.tooltip")}
        className={clsx(
          "inline-flex items-center justify-center gap-1 rounded-xl border border-violet-500/25 bg-violet-500/10 font-medium text-violet-800 transition hover:bg-violet-500/20 dark:border-violet-400/20 dark:bg-violet-950/40 dark:text-violet-200",
          iconOnly || compact ? "h-8 min-w-8 px-1.5" : "px-2.5 py-2 text-xs",
          className,
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Phone className="h-4 w-4 shrink-0" />
        )}
        {!iconOnly && !compact ? <span>3CX</span> : null}
      </button>
      {error ? (
        <span className="max-w-[10rem] truncate text-[10px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </span>
  );
}
