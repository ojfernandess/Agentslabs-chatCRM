import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminMetricCard, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type EnvVarRow = {
  key: string;
  configured: boolean;
  displayValue: string | null;
  isSecret: boolean;
};

type WebhookStats = {
  url: string;
  configured: boolean;
  eventsLast7Days: number;
  lastEventAt: string | null;
  lastEventType: string | null;
};

type ProviderDiagnostics = {
  configured: boolean;
  env: EnvVarRow[];
  webhooks: WebhookStats;
};

type StripeDiagnostics = ProviderDiagnostics & {
  checkoutConfigured: boolean;
  publishableKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  keyMode: "test" | "live" | "unknown";
  apiVersion: string;
};

type MercadoPagoDiagnostics = ProviderDiagnostics & {
  webhookConfigured: boolean;
  oauthConfigured: boolean;
  oauthRedirectUri: string;
  orgConnections: { connected: number; total: number };
};

type DiagnosticsResponse = {
  publicApiUrl: string;
  webAppUrl: string;
  stripe: StripeDiagnostics;
  mercadopago: MercadoPagoDiagnostics;
  platformEnv: EnvVarRow[];
};

type ConnectivityResult = {
  ok: boolean;
  message: string;
  testedAt: string;
  details?: Record<string, unknown>;
};

const STRIPE_SETUP_STEPS = 6;
const MP_SETUP_STEPS = 8;

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "pt-BR");
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        ok
          ? "bg-emerald-100 text-emerald-800"
          : "bg-amber-100 text-amber-800",
      )}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? copiedLabel : label}
    </button>
  );
}

function EnvTable({
  rows,
  t,
}: {
  rows: EnvVarRow[];
  t: (key: string) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">{t("superAdmin.billingProvidersEnvKey")}</th>
            <th className="px-3 py-2">{t("superAdmin.billingProvidersEnvStatus")}</th>
            <th className="px-3 py-2">{t("superAdmin.billingProvidersEnvValue")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono text-xs text-slate-800">{row.key}</td>
              <td className="px-3 py-2">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    row.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {row.configured
                    ? t("superAdmin.billingProvidersEnvConfigured")
                    : t("superAdmin.billingProvidersEnvMissing")}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">
                {row.displayValue ?? "—"}
                {row.isSecret && row.configured ? (
                  <span className="ml-2 text-slate-400">({t("superAdmin.billingProvidersEnvSecret")})</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookBlock({
  stats,
  t,
  locale,
}: {
  stats: WebhookStats;
  t: (key: string) => string;
  locale: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingProvidersWebhooksTitle")}</h4>
      <div className="flex flex-wrap items-center gap-3">
        <code className="break-all rounded bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
          {stats.url}
        </code>
        <CopyButton
          value={stats.url}
          label={t("superAdmin.billingProvidersCopyUrl")}
          copiedLabel={t("superAdmin.billingProvidersCopied")}
        />
        <StatusBadge
          ok={stats.configured}
          label={
            stats.configured
              ? t("superAdmin.billingProvidersStatusConfigured")
              : t("superAdmin.billingProvidersStatusNotConfigured")
          }
        />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingProvidersWebhookEvents7d")}</dt>
          <dd className="font-medium text-slate-900">{stats.eventsLast7Days}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingProvidersWebhookLastEvent")}</dt>
          <dd className="text-slate-800">
            {stats.lastEventAt ? (
              <>
                {formatDateTime(stats.lastEventAt, locale)}
                {stats.lastEventType ? (
                  <span className="ml-1 text-xs text-slate-500">({stats.lastEventType})</span>
                ) : null}
              </>
            ) : (
              t("superAdmin.billingProvidersWebhookNever")
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SetupSteps({ count, prefix, t }: { count: number; prefix: string; t: (key: string) => string }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>{t(`${prefix}${i + 1}`)}</li>
      ))}
    </ol>
  );
}

type SuperAdminPaymentProvidersPanelProps = {
  stripeKeyMode: "test" | "live" | "unknown";
  resetClearPlanIds: boolean;
  onResetClearPlanIdsChange: (value: boolean) => void;
  onResetStripeBindings: () => Promise<void>;
  resetBusy: boolean;
};

export function SuperAdminPaymentProvidersPanel({
  stripeKeyMode,
  resetClearPlanIds,
  onResetClearPlanIdsChange,
  onResetStripeBindings,
  resetBusy,
}: SuperAdminPaymentProvidersPanelProps) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<Record<string, ConnectivityResult>>({});

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.get<{ diagnostics: DiagnosticsResponse }>("/super/billing/payment-providers");
      setDiagnostics(res.diagnostics);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingProvidersLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const runTest = async (provider: "stripe" | "mercadopago" | "all") => {
    setTesting(provider);
    setError("");
    try {
      const res = await api.post<{ results: Record<string, ConnectivityResult> }>(
        "/super/billing/payment-providers/test",
        { provider },
      );
      setConnectivity((prev) => ({ ...prev, ...res.results }));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingProvidersTestError"));
    } finally {
      setTesting(null);
    }
  };

  if (loading && !diagnostics) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  const stripe = diagnostics?.stripe;
  const mp = diagnostics?.mercadopago;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => void load()}>
          <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
          {t("superAdmin.billingProvidersRefresh")}
        </button>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5 text-sm"
          disabled={testing !== null}
          onClick={() => void runTest("all")}
        >
          {testing === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {t("superAdmin.billingProvidersTestAll")}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {diagnostics ? (
        <SuperAdminPanel className="p-4">
          <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingProvidersPlatformUrls")}</h4>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingProvidersPublicApiUrl")}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-slate-50 px-2 py-1 text-xs">{diagnostics.publicApiUrl}</code>
                <CopyButton
                  value={diagnostics.publicApiUrl}
                  label={t("superAdmin.billingProvidersCopyUrl")}
                  copiedLabel={t("superAdmin.billingProvidersCopied")}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingProvidersWebAppUrl")}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-slate-50 px-2 py-1 text-xs">{diagnostics.webAppUrl}</code>
                <CopyButton
                  value={diagnostics.webAppUrl}
                  label={t("superAdmin.billingProvidersCopyUrl")}
                  copiedLabel={t("superAdmin.billingProvidersCopied")}
                />
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("superAdmin.billingProvidersEnvTitle")}
            </p>
            <EnvTable rows={diagnostics.platformEnv} t={t} />
          </div>
        </SuperAdminPanel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SuperAdminMetricCard
          label="Stripe"
          value={stripe?.configured ? t("superAdmin.billingProvidersStatusConfigured") : t("superAdmin.billingProvidersStatusNotConfigured")}
          hint={
            stripeKeyMode === "live"
              ? t("superAdmin.billingStripeModeLive")
              : stripeKeyMode === "test"
                ? t("superAdmin.billingStripeModeTest")
                : t("superAdmin.billingStripeModeUnknown")
          }
          accent={stripe?.configured ? "emerald" : "amber"}
        />
        <SuperAdminMetricCard
          label="Mercado Pago"
          value={
            mp?.configured
              ? t("superAdmin.billingProvidersStatusConfigured")
              : t("superAdmin.billingProvidersStatusNotConfigured")
          }
          hint={t("superAdmin.billingProvidersMpOrgConnections")
            .replace("{connected}", String(mp?.orgConnections.connected ?? 0))
            .replace("{total}", String(mp?.orgConnections.total ?? 0))}
          accent={mp?.configured ? "emerald" : "amber"}
        />
      </div>

      {stripe ? (
        <SuperAdminPanel className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.billingProvidersStripeTitle")}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge
                  ok={stripe.configured}
                  label={
                    stripe.configured
                      ? t("superAdmin.billingProvidersStatusConfigured")
                      : t("superAdmin.billingProvidersStatusPartial")
                  }
                />
                {stripe.publishableKeyConfigured ? (
                  <StatusBadge ok label={t("superAdmin.billingProvidersStripePublishableOk")} />
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://dashboard.stripe.com/test/apikeys"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary inline-flex items-center gap-1 text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Stripe Dashboard
              </a>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={testing !== null}
                onClick={() => void runTest("stripe")}
              >
                {testing === "stripe" ? t("common.loading") : t("superAdmin.billingProvidersTestConnection")}
              </button>
            </div>
          </div>

          {connectivity.stripe ? (
            <div
              className={clsx(
                "rounded-lg border px-4 py-3 text-sm",
                connectivity.stripe.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800",
              )}
            >
              {connectivity.stripe.ok
                ? t("superAdmin.billingProvidersTestOk")
                : t("superAdmin.billingProvidersTestFailed")}
              : {connectivity.stripe.message}
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("superAdmin.billingProvidersEnvTitle")}
            </p>
            <EnvTable rows={stripe.env} t={t} />
          </div>

          <WebhookBlock stats={stripe.webhooks} t={t} locale={locale} />

          <div>
            <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingProvidersSetupTitle")}</h4>
            <SetupSteps count={STRIPE_SETUP_STEPS} prefix="superAdmin.billingProvidersStripeSetup" t={t} />
          </div>

          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingStripeModeTitle")}</h4>
            <p className="text-sm text-slate-600">
              {t("superAdmin.billingStripeModeCurrent").replace(
                "{mode}",
                stripeKeyMode === "live"
                  ? t("superAdmin.billingStripeModeLive")
                  : stripeKeyMode === "test"
                    ? t("superAdmin.billingStripeModeTest")
                    : t("superAdmin.billingStripeModeUnknown"),
              )}
            </p>
            <p className="text-sm text-slate-600">{t("superAdmin.billingResetStripeHint")}</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={resetClearPlanIds}
                onChange={(e) => onResetClearPlanIdsChange(e.target.checked)}
              />
              {t("superAdmin.billingResetStripeClearPlans")}
            </label>
            <button
              type="button"
              className="btn-secondary border-amber-300 text-amber-900"
              disabled={resetBusy}
              onClick={() => void onResetStripeBindings()}
            >
              {resetBusy ? t("common.saving") : t("superAdmin.billingResetStripeAction")}
            </button>
          </div>
        </SuperAdminPanel>
      ) : null}

      {mp ? (
        <SuperAdminPanel className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.billingProvidersMercadoPagoTitle")}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge
                  ok={mp.configured}
                  label={
                    mp.configured
                      ? t("superAdmin.billingProvidersStatusConfigured")
                      : t("superAdmin.billingProvidersStatusNotConfigured")
                  }
                />
                <StatusBadge
                  ok={mp.webhookConfigured}
                  label={
                    mp.webhookConfigured
                      ? t("superAdmin.billingProvidersMpWebhookOk")
                      : t("superAdmin.billingProvidersMpWebhookMissing")
                  }
                />
                <StatusBadge
                  ok={mp.oauthConfigured}
                  label={
                    mp.oauthConfigured
                      ? t("superAdmin.billingProvidersMpOAuthOk")
                      : t("superAdmin.billingProvidersMpOAuthMissing")
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://www.mercadopago.com.br/developers/panel/app"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary inline-flex items-center gap-1 text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                MP Developers
              </a>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={testing !== null}
                onClick={() => void runTest("mercadopago")}
              >
                {testing === "mercadopago" ? t("common.loading") : t("superAdmin.billingProvidersTestConnection")}
              </button>
            </div>
          </div>

          {connectivity.mercadopago ? (
            <div
              className={clsx(
                "rounded-lg border px-4 py-3 text-sm",
                connectivity.mercadopago.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800",
              )}
            >
              {connectivity.mercadopago.ok
                ? t("superAdmin.billingProvidersTestOk")
                : t("superAdmin.billingProvidersTestFailed")}
              : {connectivity.mercadopago.message}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("superAdmin.billingProvidersMpOAuthRedirect")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-white px-2 py-1 text-xs">{mp.oauthRedirectUri}</code>
              <CopyButton
                value={mp.oauthRedirectUri}
                label={t("superAdmin.billingProvidersCopyUrl")}
                copiedLabel={t("superAdmin.billingProvidersCopied")}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("superAdmin.billingProvidersEnvTitle")}
            </p>
            <EnvTable rows={mp.env} t={t} />
          </div>

          <WebhookBlock stats={mp.webhooks} t={t} locale={locale} />

          <div>
            <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingProvidersSetupTitle")}</h4>
            <SetupSteps count={MP_SETUP_STEPS} prefix="superAdmin.billingProvidersMpSetup" t={t} />
          </div>
        </SuperAdminPanel>
      ) : null}
    </div>
  );
}
