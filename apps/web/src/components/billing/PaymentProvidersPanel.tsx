import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsCard,
  settingsMuted,
  settingsSubtitle,
  settingsTitle,
} from "@/components/settings/settingsUi";

type ProviderCapabilities = {
  subscriptions: boolean;
  pix: boolean;
  creditCard: boolean;
  checkout: boolean;
  qrCode: boolean;
  billingPortal: boolean;
};

type StripeProviderRow = {
  label: string;
  configured: boolean;
  connected: boolean;
  publishableKey: string | null;
  platformConfigured: boolean;
  capabilities: ProviderCapabilities;
};

type MercadoPagoProviderRow = {
  label: string;
  configured: boolean;
  connected: boolean;
  status: string;
  environment: string;
  hasAccessToken: boolean;
  publicKey: string | null;
  externalUserIdMasked: string | null;
  connectedAt: string | null;
  oauthAvailable: boolean;
  capabilities: ProviderCapabilities;
};

type ProvidersResponse = {
  stripe: StripeProviderRow;
  mercadopago: MercadoPagoProviderRow;
  defaultProvider: "stripe" | "mercadopago";
};

const TOKEN_PLACEHOLDER = "••••••••";

export function PaymentProvidersPanel({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [showManualForm, setShowManualForm] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.get<ProvidersResponse>("/billing/providers");
      setProviders(res);
      if (res.mercadopago.publicKey) setPublicKey(res.mercadopago.publicKey);
      if (res.mercadopago.environment === "production" || res.mercadopago.environment === "sandbox") {
        setEnvironment(res.mercadopago.environment);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.billingProvidersLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.billingProvidersActionError"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className={clsx(settingsCard, "flex items-center gap-2 text-sm text-ink-500")}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </section>
    );
  }

  const mp = providers?.mercadopago;
  const stripe = providers?.stripe;

  return (
    <section className="space-y-4">
      <div>
        <h3 className={settingsTitle}>{t("settings.billingProvidersTitle")}</h3>
        <p className={settingsSubtitle}>{t("settings.billingProvidersIntro")}</p>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{success}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={settingsCard}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Stripe</p>
              <p className={settingsMuted}>{t("settings.billingProviderStripeHint")}</p>
            </div>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                stripe?.platformConfigured
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
              )}
            >
              {stripe?.platformConfigured
                ? t("settings.billingProviderPlatformConfigured")
                : t("settings.billingProviderPlatformNotConfigured")}
            </span>
          </div>
          {stripe?.platformConfigured ? (
            <ul className="mt-4 space-y-1 text-xs text-ink-600 dark:text-ink-300">
              {stripe.capabilities.creditCard ? <li>✓ {t("settings.billingProviderCapCard")}</li> : null}
              {stripe.capabilities.subscriptions ? <li>✓ {t("settings.billingProviderCapSubscriptions")}</li> : null}
              {stripe.capabilities.billingPortal ? <li>✓ {t("settings.billingProviderCapPortal")}</li> : null}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">{t("settings.billingStripeNotConfiguredHint")}</p>
          )}
        </div>

        <div className={settingsCard}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Mercado Pago</p>
              <p className={settingsMuted}>{t("settings.billingProviderMercadoPagoHint")}</p>
            </div>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                mp?.connected
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
              )}
            >
              {mp?.connected ? t("settings.billingProviderConnected") : t("settings.billingProviderNotConnected")}
            </span>
          </div>

          {mp?.connected ? (
            <div className="mt-4 space-y-2 text-sm text-ink-700 dark:text-ink-200">
              {mp.externalUserIdMasked ? (
                <p>
                  {t("settings.billingProviderAccount")}: <strong>{mp.externalUserIdMasked}</strong>
                </p>
              ) : null}
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {t("settings.billingProviderEnvironment")}: {mp.environment}
              </p>
              <ul className="space-y-1 text-xs text-ink-600 dark:text-ink-300">
                {mp.capabilities.pix ? <li>✓ Pix</li> : null}
                {mp.capabilities.creditCard ? <li>✓ {t("settings.billingProviderCapCard")}</li> : null}
                {mp.capabilities.subscriptions ? <li>✓ {t("settings.billingProviderCapSubscriptions")}</li> : null}
              </ul>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("mp-test", async () => {
                      await api.post("/billing/providers/mercadopago/test");
                      setSuccess(t("settings.billingProviderTestOk"));
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium hover:bg-ink-50 dark:border-soft-border dark:hover:bg-ink-800"
                >
                  {busy === "mp-test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {t("settings.billingProviderTestConnection")}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("mp-disconnect", async () => {
                      await api.delete("/billing/providers/mercadopago");
                      setAccessToken("");
                      setSuccess(t("settings.billingProviderDisconnected"));
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  {busy === "mp-disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                  {t("settings.billingProviderDisconnect")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {mp?.oauthAvailable ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("mp-oauth", async () => {
                      const res = await api.post<{ authorizationUrl: string }>(
                        "/billing/providers/mercadopago/oauth/start",
                      );
                      window.location.href = res.authorizationUrl;
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy === "mp-oauth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                  {t("settings.billingProviderConnectOAuth")}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setShowManualForm((v) => !v)}
                className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300"
              >
                <ExternalLink className="h-4 w-4" />
                {showManualForm
                  ? t("settings.billingProviderHideManualConnect")
                  : t("settings.billingProviderManualConnect")}
              </button>

              {showManualForm ? (
                <form
                  className="space-y-3 rounded-lg border border-ink-100 p-4 dark:border-soft-border"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction("mp-connect", async () => {
                      await api.post("/billing/providers/mercadopago/connect", {
                        accessToken,
                        publicKey: publicKey.trim() || null,
                        environment,
                      });
                      setAccessToken("");
                      setSuccess(t("settings.billingProviderConnectSuccess"));
                    });
                  }}
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-200">
                      {t("settings.billingProviderAccessToken")}
                    </label>
                    <input
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder={mp?.hasAccessToken ? TOKEN_PLACEHOLDER : t("settings.billingProviderAccessTokenPlaceholder")}
                      className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-soft-border dark:bg-ink-900"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-200">
                      {t("settings.billingProviderPublicKey")}
                    </label>
                    <input
                      type="text"
                      value={publicKey}
                      onChange={(e) => setPublicKey(e.target.value)}
                      placeholder="APP_USR-..."
                      className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-soft-border dark:bg-ink-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-ink-200">
                      {t("settings.billingProviderEnvironment")}
                    </label>
                    <select
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value as "sandbox" | "production")}
                      className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-soft-border dark:bg-ink-900"
                    >
                      <option value="sandbox">{t("settings.billingProviderEnvSandbox")}</option>
                      <option value="production">{t("settings.billingProviderEnvProduction")}</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={Boolean(busy) || !accessToken.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {busy === "mp-connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                    {t("settings.billingProviderConnect")}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
