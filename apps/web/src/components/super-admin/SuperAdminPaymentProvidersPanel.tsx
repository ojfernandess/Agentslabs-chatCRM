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
  enabled: boolean;
  checkoutReady: boolean;
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

type MercadoPagoBillingModeDiagnostics = {
  mode: "sandbox" | "production";
  activeAccessTokenConfigured: boolean;
  activePublicKeyConfigured: boolean;
  tokenMode: "sandbox" | "production" | "unknown";
  tokenModeMismatch: boolean;
  activeAccessTokenPreview: string | null;
  activePublicKeyPreview: string | null;
};

type MercadoPagoDiagnostics = ProviderDiagnostics & {
  webhookConfigured: boolean;
  oauthConfigured: boolean;
  oauthRedirectUri: string;
  orgConnections: { connected: number; total: number };
  billingMode: MercadoPagoBillingModeDiagnostics;
};

type DiagnosticsResponse = {
  publicApiUrl: string;
  webAppUrl: string;
  providerToggles: {
    stripe: { enabled: boolean };
    mercadopago: { enabled: boolean };
    stripeReady: boolean;
    mercadopagoReady: boolean;
  };
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
  const [mpMode, setMpMode] = useState<"sandbox" | "production">("sandbox");
  const [mpModeSaving, setMpModeSaving] = useState(false);
  const [mpModeSuccess, setMpModeSuccess] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [mercadoPagoEnabled, setMercadoPagoEnabled] = useState(true);
  const [providerTogglesSaving, setProviderTogglesSaving] = useState(false);
  const [providerTogglesSuccess, setProviderTogglesSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.get<{ diagnostics: DiagnosticsResponse }>("/super/billing/payment-providers");
      setDiagnostics(res.diagnostics);
      setMpMode(res.diagnostics.mercadopago.billingMode.mode);
      setStripeEnabled(res.diagnostics.providerToggles.stripe.enabled);
      setMercadoPagoEnabled(res.diagnostics.providerToggles.mercadopago.enabled);
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

  const saveProviderToggles = async () => {
    setProviderTogglesSaving(true);
    setProviderTogglesSuccess("");
    setError("");
    try {
      await api.patch("/super/billing/payment-providers", {
        stripe: { enabled: stripeEnabled },
        mercadopago: { enabled: mercadoPagoEnabled },
      });
      setProviderTogglesSuccess(t("superAdmin.billingProvidersTogglesSaved"));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingProvidersTogglesSaveError"));
    } finally {
      setProviderTogglesSaving(false);
    }
  };

  const saveMercadoPagoMode = async () => {
    setMpModeSaving(true);
    setMpModeSuccess("");
    setError("");
    try {
      const res = await api.patch<{ settings: { mode: "sandbox" | "production" } }>(
        "/super/billing/payment-providers/mercadopago",
        { mode: mpMode },
      );
      setMpMode(res.settings.mode);
      setMpModeSuccess(t("superAdmin.billingMercadoPagoModeSaved"));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingMercadoPagoModeSaveError"));
    } finally {
      setMpModeSaving(false);
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

      {providerTogglesSuccess ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {providerTogglesSuccess}
        </div>
      ) : null}

      {diagnostics ? (
        <SuperAdminPanel className="space-y-4 p-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.billingProvidersTogglesTitle")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t("superAdmin.billingProvidersTogglesHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
              <input
                type="checkbox"
                className="mt-1"
                checked={stripeEnabled}
                onChange={(e) => setStripeEnabled(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Stripe</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {diagnostics.providerToggles.stripeReady
                    ? t("superAdmin.billingProvidersToggleReady")
                    : t("superAdmin.billingProvidersToggleNotReady")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
              <input
                type="checkbox"
                className="mt-1"
                checked={mercadoPagoEnabled}
                onChange={(e) => setMercadoPagoEnabled(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Mercado Pago</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {diagnostics.providerToggles.mercadopagoReady
                    ? t("superAdmin.billingProvidersToggleReady")
                    : t("superAdmin.billingProvidersToggleNotReady")}
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={providerTogglesSaving}
              onClick={() => void saveProviderToggles()}
            >
              {providerTogglesSaving ? t("common.saving") : t("superAdmin.billingProvidersTogglesSave")}
            </button>
          </div>
        </SuperAdminPanel>
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
          value={
            stripe?.enabled
              ? stripe.checkoutReady
                ? t("superAdmin.billingProvidersStatusActive")
                : t("superAdmin.billingProvidersStatusEnabledNotReady")
              : t("superAdmin.billingProvidersStatusDisabled")
          }
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
            mp?.enabled
              ? mp.checkoutReady
                ? t("superAdmin.billingProvidersStatusActive")
                : t("superAdmin.billingProvidersStatusEnabledNotReady")
              : t("superAdmin.billingProvidersStatusDisabled")
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
                  ok={stripe.checkoutReady}
                  label={
                    !stripe.enabled
                      ? t("superAdmin.billingProvidersStatusDisabled")
                      : stripe.checkoutReady
                        ? t("superAdmin.billingProvidersStatusActive")
                        : t("superAdmin.billingProvidersStatusEnabledNotReady")
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
                  ok={mp.enabled && mp.checkoutReady}
                  label={
                    !mp.enabled
                      ? t("superAdmin.billingProvidersStatusDisabled")
                      : mp.checkoutReady
                        ? t("superAdmin.billingProvidersStatusActive")
                        : t("superAdmin.billingProvidersStatusEnabledNotReady")
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

          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingMercadoPagoModeTitle")}</h4>
            <p className="text-sm text-slate-600">{t("superAdmin.billingMercadoPagoModeHint")}</p>
            <div className="flex flex-wrap gap-4 text-sm text-slate-800">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="mp-billing-mode"
                  checked={mpMode === "sandbox"}
                  onChange={() => setMpMode("sandbox")}
                />
                {t("superAdmin.billingMercadoPagoModeSandbox")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="mp-billing-mode"
                  checked={mpMode === "production"}
                  onChange={() => setMpMode("production")}
                />
                {t("superAdmin.billingMercadoPagoModeProduction")}
              </label>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingMercadoPagoActiveToken")}</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {mp.billingMode.activeAccessTokenPreview ?? t("superAdmin.billingProvidersEnvMissing")}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">{t("superAdmin.billingMercadoPagoDetectedTokenMode")}</dt>
                <dd className="text-slate-800">
                  {mp.billingMode.tokenMode === "sandbox"
                    ? t("superAdmin.billingMercadoPagoModeSandbox")
                    : mp.billingMode.tokenMode === "production"
                      ? t("superAdmin.billingMercadoPagoModeProduction")
                      : t("superAdmin.billingMercadoPagoTokenModeUnknown")}
                </dd>
              </div>
            </dl>
            {mp.billingMode.tokenModeMismatch ? (
              <p className="text-sm text-red-700">{t("superAdmin.billingMercadoPagoModeMismatch")}</p>
            ) : null}
            {mpModeSuccess ? <p className="text-sm text-emerald-700">{mpModeSuccess}</p> : null}
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={mpModeSaving}
              onClick={() => void saveMercadoPagoMode()}
            >
              {mpModeSaving ? t("common.saving") : t("superAdmin.billingMercadoPagoModeSave")}
            </button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingProvidersSetupTitle")}</h4>
            <SetupSteps count={MP_SETUP_STEPS} prefix="superAdmin.billingProvidersMpSetup" t={t} />
          </div>
        </SuperAdminPanel>
      ) : null}
    </div>
  );
}
