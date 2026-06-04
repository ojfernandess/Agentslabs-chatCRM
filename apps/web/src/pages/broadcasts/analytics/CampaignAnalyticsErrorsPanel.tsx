import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { BroadcastCampaignAnalytics, BroadcastErrorCategory } from "./types";

const ERROR_CATEGORY_KEYS: Record<BroadcastErrorCategory, string> = {
  invalid_number: "broadcastPage.analyticsErrorInvalidNumber",
  carrier_block: "broadcastPage.analyticsErrorCarrierBlock",
  gateway: "broadcastPage.analyticsErrorGateway",
  whatsapp_window: "broadcastPage.analyticsErrorWhatsappWindow",
  template: "broadcastPage.analyticsErrorTemplate",
  flow_skip: "broadcastPage.analyticsErrorFlowSkip",
  voice: "broadcastPage.analyticsErrorVoice",
  email: "broadcastPage.analyticsErrorEmail",
  rate_limit: "broadcastPage.analyticsErrorRateLimit",
  unknown: "broadcastPage.analyticsErrorUnknown",
};

interface Props {
  errorsByCategory: BroadcastCampaignAnalytics["errorsByCategory"];
  errorSpikeAlert: BroadcastCampaignAnalytics["errorSpikeAlert"];
  loading?: boolean;
}

export function CampaignAnalyticsErrorsPanel({ errorsByCategory, errorSpikeAlert, loading }: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      {errorSpikeAlert?.active ? (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">{t("broadcastPage.analyticsErrorSpikeTitle")}</p>
            <p className="mt-0.5">
              {t("broadcastPage.analyticsErrorSpikeBody")
                .replace("{count}", String(errorSpikeAlert.failedLast24h))
                .replace("{baseline}", String(errorSpikeAlert.baselineDaily))}
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsErrorsTitle")}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsErrorsSub")}</p>
        {loading ? (
          <p className="mt-4 text-sm text-ink-500">{t("common.loading")}</p>
        ) : errorsByCategory.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">{t("broadcastPage.analyticsErrorsEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {errorsByCategory.map((row) => (
              <li
                key={row.category}
                className="rounded-xl border border-rose-200/60 bg-rose-50/40 px-3 py-3 dark:border-rose-900/40 dark:bg-rose-950/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-rose-900 dark:text-rose-100">
                    {t(ERROR_CATEGORY_KEYS[row.category])}
                  </span>
                  <span className="rounded-full bg-rose-200/80 px-2 py-0.5 text-xs font-bold tabular-nums text-rose-900 dark:bg-rose-900/50 dark:text-rose-100">
                    {row.count}
                  </span>
                </div>
                {row.sampleMessage ? (
                  <p className="mt-1 text-xs text-rose-800/90 dark:text-rose-200/80">{row.sampleMessage}</p>
                ) : null}
                {row.affectedPhones.length > 0 ? (
                  <p className={clsx("mt-2 text-[11px] font-mono text-rose-800 dark:text-rose-300")}>
                    {t("broadcastPage.analyticsAffectedPhones")}: {row.affectedPhones.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
