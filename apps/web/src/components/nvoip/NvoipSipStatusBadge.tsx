import { Phone } from "lucide-react";
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
  const label =
    sip.incoming && sip.status === "ringing"
      ? t("nvoip.softphone.incoming")
      : t(labelKey) === labelKey
        ? sip.status
        : t(labelKey);

  const problem =
    sip.error === "sip_server_not_configured"
      ? t("nvoip.sip.serverNotConfigured")
      : sip.error === "sip_credentials_not_configured"
        ? t("nvoip.sip.notRegistered")
        : sip.error?.startsWith("sip_registration_failed")
          ? t("nvoip.sip.registrationFailed")
          : sip.error
            ? t("nvoip.sip.errorHint")
            : null;

  const phoneMark = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
      <Phone className="h-4 w-4" aria-hidden />
    </span>
  );

  if (compact) {
    return (
      <span className="inline-flex" title={problem ?? `${t("nvoip.softphone.title")} · ${label}`}>
        {phoneMark}
      </span>
    );
  }

  return (
    <span
      className="inline-flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-ink-700 dark:bg-ink-900"
      title={problem ?? undefined}
    >
      {phoneMark}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-ink-50">
          {t("nvoip.softphone.title")}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-ink-400">
          <span className={clsx("h-2 w-2 rounded-full", STATUS_COLORS[sip.status] ?? "bg-slate-400")} />
          {label}
        </span>
        {problem ? <span className="block truncate text-xs text-red-600">{problem}</span> : null}
      </span>
    </span>
  );
}
