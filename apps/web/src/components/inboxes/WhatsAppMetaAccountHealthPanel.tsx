import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Plug, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  isInboxWhatsappConfigured,
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

export type WhatsappHealthCheckId =
  | "number_quality"
  | "display_name"
  | "payment_active"
  | "business_verified"
  | "inbound_webhook";

type HealthCheck = {
  id: WhatsappHealthCheckId;
  ok: boolean;
  meta?: Record<string, string>;
};

type HealthPayload = {
  connected: boolean;
  provider: "meta" | "360dialog";
  verifiedName: string | null;
  displayPhone: string | null;
  connectedSince: string | null;
  qualityRating: string | null;
  qualityLevel: "high" | "medium" | "low" | "unknown";
  phoneStatus: string | null;
  checks: HealthCheck[];
  lastCheckedAt: string;
  webhook?: {
    url: string;
    verifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
    lastInboundWebhookAt: string | null;
    receivingOk: boolean;
  };
  error?: string;
};

type Props = {
  inboxId: string;
  inboxName: string;
  channelConfig: unknown;
  className?: string;
};

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function qualityBadgeClass(level: HealthPayload["qualityLevel"]): string {
  if (level === "high") return "bg-emerald-500/15 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200";
  if (level === "medium") return "bg-amber-500/15 text-amber-900 ring-amber-500/30 dark:text-amber-200";
  if (level === "low") return "bg-red-500/15 text-red-800 ring-red-500/30 dark:text-red-200";
  return "bg-ink-100 text-ink-600 ring-ink-200 dark:bg-ink-800 dark:text-ink-300";
}

export function WhatsAppMetaAccountHealthPanel({ inboxId, inboxName, channelConfig, className }: Props) {
  const { t, locale } = useI18n();
  const wa = parseInboxWhatsappFromChannelConfig(channelConfig);
  const cloud = isWhatsAppCloudApiProvider(wa.whatsappProvider ?? "");
  const configured = isInboxWhatsappConfigured(wa);

  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cloud || !configured) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<HealthPayload>(`/inboxes/${inboxId}/whatsapp-account-health`);
      setHealth(data);
      if (data.error && data.error !== "not_configured") {
        setError(data.error);
      }
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : t("inboxesPage.whatsappHealth.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [cloud, configured, inboxId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cloud || !configured) return null;

  const displayLabel =
    health?.verifiedName && health.displayPhone
      ? `${health.verifiedName} · ${health.displayPhone}`
      : health?.displayPhone ?? health?.verifiedName ?? wa.whatsappDisplayPhone ?? inboxName;

  const qualityLabel = t(
    `inboxesPage.whatsappHealth.quality.${health?.qualityLevel ?? "unknown"}` as "inboxesPage.whatsappHealth.quality.high",
  );

  const allChecksOk = health?.checks?.length ? health.checks.every((c) => c.ok) : false;

  return (
    <div className={clsx("space-y-4", className)}>
      <div className="overflow-hidden rounded-2xl border border-ink-200/80 bg-gradient-to-br from-white to-slate-50/90 shadow-sm dark:border-ink-700/80 dark:from-ink-950/80 dark:to-ink-900/40">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 p-4 dark:border-ink-800 sm:p-5">
          <div className="flex min-w-0 flex-1 gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-ink-200/80 dark:bg-ink-900 dark:ring-ink-700">
              <Plug
                className={clsx(
                  "h-6 w-6",
                  health?.connected !== false ? "text-emerald-600" : "text-ink-400",
                )}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                  {health?.connected !== false
                    ? t("inboxesPage.whatsappHealth.connected")
                    : t("inboxesPage.whatsappHealth.disconnected")}
                </h3>
                <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t("inboxesPage.whatsappHealth.officialApi")}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-ink-600 dark:text-ink-300">{displayLabel}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {whatsappProviderLabel(wa.whatsappProvider)} · Meta Cloud API
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              {t("inboxesPage.whatsappHealth.connectedSince")}
            </p>
            <p className="mt-1 text-sm font-medium text-ink-900 dark:text-ink-100">
              {formatDateTime(health?.connectedSince ?? null, locale)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              {t("inboxesPage.whatsappHealth.numberQuality")}
            </p>
            <p className="mt-1">
              <span
                className={clsx(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1",
                  qualityBadgeClass(health?.qualityLevel ?? "unknown"),
                )}
              >
                {qualityLabel}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-sm dark:border-ink-700/80 dark:bg-ink-950/60 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {t("inboxesPage.whatsappHealth.sectionTitle")}
            </h4>
            <p className="mt-0.5 text-xs text-ink-500">
              {allChecksOk
                ? t("inboxesPage.whatsappHealth.allGood")
                : t("inboxesPage.whatsappHealth.reviewNeeded")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("inboxesPage.whatsappHealth.refresh")}
          </button>
        </div>

        {loading && !health ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : error && !health?.checks?.length ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            {error}
          </p>
        ) : (
          <ul className="space-y-2">
            {(health?.checks ?? []).map((check) => (
              <li
                key={check.id}
                className={clsx(
                  "flex gap-3 rounded-xl border px-3 py-3 sm:px-4",
                  check.ok
                    ? "border-ink-100 bg-ink-50/80 dark:border-ink-800 dark:bg-ink-900/40"
                    : "border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
                )}
              >
                <div
                  className={clsx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    check.ok
                      ? "bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-500/20 dark:bg-ink-950"
                      : "bg-white text-amber-600 ring-1 ring-amber-500/25 dark:bg-ink-950",
                  )}
                >
                  <Check className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                    {t(`inboxesPage.whatsappHealth.checks.${check.id}.title` as "inboxesPage.whatsappHealth.checks.number_quality.title")}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                    {check.ok
                      ? t(`inboxesPage.whatsappHealth.checks.${check.id}.ok` as "inboxesPage.whatsappHealth.checks.number_quality.ok")
                      : t(
                          `inboxesPage.whatsappHealth.checks.${check.id}.pending` as "inboxesPage.whatsappHealth.checks.number_quality.pending",
                        )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {health?.lastCheckedAt ? (
          <p className="mt-4 text-[11px] text-ink-400">
            {t("inboxesPage.whatsappHealth.lastCheck")}: {formatDateTime(health.lastCheckedAt, locale)}
          </p>
        ) : null}

        {health?.webhook ? (
          <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/60 px-3 py-3 text-xs dark:border-ink-800 dark:bg-ink-900/40">
            <p className="font-semibold text-ink-700 dark:text-ink-200">
              {t("inboxesPage.whatsappHealth.webhookUrl")}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-ink-600 dark:text-ink-300">
              {health.webhook.url}
            </p>
            <p className="mt-2 text-ink-500">
              {t("inboxesPage.whatsappHealth.webhookLastInbound")}:{" "}
              {health.webhook.lastInboundWebhookAt
                ? formatDateTime(health.webhook.lastInboundWebhookAt, locale)
                : t("inboxesPage.whatsappHealth.webhookNever")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
