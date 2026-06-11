import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipSipPhoneOptional } from "@/contexts/NvoipSipPhoneContext";

const STATUS_COLORS: Record<string, string> = {
  registered: "bg-emerald-500",
  unregistered: "bg-slate-400",
  ringing: "bg-amber-400 animate-pulse",
  "in-call": "bg-sky-500 animate-pulse",
  ended: "bg-slate-400",
  error: "bg-red-500",
};

export function NvoipSipStatusBadge({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const sip = useNvoipSipPhoneOptional();
  if (!sip.enabled) return null;

  const labelKey = `nvoip.sip.status.${sip.status}`;
  const label = t(labelKey) === labelKey ? sip.status : t(labelKey);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-ink-600 dark:text-ink-300",
        compact ? "text-[10px]" : "text-xs",
      )}
      title={sip.error ? t("nvoip.sip.errorHint") : undefined}
    >
      <span className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_COLORS[sip.status] ?? "bg-slate-400")} />
      {!compact ? <span className="truncate">{label}</span> : null}
    </span>
  );
}
