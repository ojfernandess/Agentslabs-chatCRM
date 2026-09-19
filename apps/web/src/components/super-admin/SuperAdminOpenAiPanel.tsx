import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import clsx from "clsx";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Settings2,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { MeasuredResponsiveContainer } from "@/components/charts/MeasuredResponsiveContainer";

type OpenAiPanelTab = "monitoring" | "settings";
type ChartRange = "7d" | "30d" | "month";

type OpenAiSettings = {
  configured: boolean;
  connected: boolean;
  adminApiKeyMasked: string;
  initialBalanceUsd: string | null;
  lastSyncedAt: string | null;
};

type OpenAiDashboardResponse = {
  dashboard: {
    source: "openai";
    syncedAt: string | null;
    stale: boolean;
    syncError: string | null;
    costs: { todayUsd: number; monthUsd: number; last30DaysUsd: number };
    estimatedBalanceUsd: number | null;
    hasOfficialBalanceApi: boolean;
    apiCreditBalance: {
      hasOfficialSource: boolean;
      trackingEnabled: boolean;
      totalDepositedUsd: number;
      totalConsumedUsd: number;
      estimatedRemainingUsd: number | null;
      initialBalanceUsd: number | null;
      totalRechargesUsd: number;
    };
    chart: { range: ChartRange; from: string; to: string; daily: { date: string; amountUsd: number }[] };
    detail: { date: string; category: string; projectId: string | null; amountUsd: number }[];
    projects: { id: string; amountUsd: number }[];
    recharges: { id: string; amountUsd: string; rechargedAt: string; note: string | null; status: string }[];
  };
  profitability: {
    usdBrlRate: number;
    creditsConsumedBrl: string;
    openAiCostBrl: string;
    marginBrl: string;
  };
};

const MASKED_KEY = "••••••••";

function formatUsdAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
}

function formatBrlAmount(value: string, locale: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(amount);
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale);
}

function AlertBanner({
  tone,
  children,
}: {
  tone: "success" | "error" | "warning";
  children: ReactNode;
}) {
  const styles =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={clsx("rounded-xl border px-4 py-3 text-sm", styles)}>{children}</div>;
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        {subtitle ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  footer,
  accent,
}: {
  label: string;
  value: string;
  footer: string;
  accent?: "brand" | "amber" | "emerald";
}) {
  const accentClass =
    accent === "amber"
      ? "border-amber-200 bg-amber-50/60"
      : accent === "emerald"
        ? "border-emerald-200 bg-emerald-50/60"
        : "border-slate-200 bg-white";
  return (
    <div className={clsx("min-w-0 rounded-xl border p-4 shadow-sm", accentClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{footer}</p>
    </div>
  );
}

function ApiCreditBalancePanel({
  balance,
  syncedAt,
  locale,
  t,
  onConfigure,
}: {
  balance: OpenAiDashboardResponse["dashboard"]["apiCreditBalance"];
  syncedAt: string | null;
  locale: string;
  t: (key: string) => string;
  onConfigure: () => void;
}) {
  if (!balance.trackingEnabled) {
    return (
      <SuperAdminPanel className="overflow-hidden border-amber-200 bg-amber-50/40 p-0">
        <SectionHeader
          icon={Wallet}
          title={t("superAdmin.openAiApiCreditBalanceTitle")}
          subtitle={t("superAdmin.openAiApiCreditBalanceNoTracking")}
          action={
            <button type="button" className="btn-secondary text-xs" onClick={onConfigure}>
              {t("superAdmin.openAiApiCreditBalanceConfigure")}
            </button>
          }
        />
        <div className="px-5 pb-5">
          <p className="text-sm leading-relaxed text-amber-950/80">{t("superAdmin.openAiApiCreditBalanceNoTrackingHint")}</p>
        </div>
      </SuperAdminPanel>
    );
  }

  const remaining = balance.estimatedRemainingUsd ?? 0;
  const isLow = remaining < 10;

  return (
    <SuperAdminPanel className="overflow-hidden p-0">
      <SectionHeader
        icon={Wallet}
        title={t("superAdmin.openAiApiCreditBalanceTitle")}
        subtitle={t("superAdmin.openAiApiCreditBalanceSubtitle")}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("superAdmin.openAiApiCreditBalanceRemaining")}
            </p>
            <p
              className={clsx(
                "mt-1 text-3xl font-bold tabular-nums",
                isLow ? "text-amber-700" : "text-slate-900",
              )}
            >
              ≈ {formatUsdAmount(remaining, locale)}
            </p>
            <p className="mt-1 text-xs text-slate-500" title={t("superAdmin.openAiEstimatedBalanceTooltip")}>
              {t("superAdmin.openAiApiCreditBalanceEstimatedTag")}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {t("superAdmin.openAiApiCreditBalanceUpdated")}: {formatDateTime(syncedAt, locale)}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("superAdmin.openAiApiCreditBalanceDeposited")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {formatUsdAmount(balance.totalDepositedUsd, locale)}
            </p>
            {balance.initialBalanceUsd != null || balance.totalRechargesUsd > 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {balance.initialBalanceUsd != null
                  ? t("superAdmin.openAiApiCreditBalanceInitial").replace(
                      "{amount}",
                      formatUsdAmount(balance.initialBalanceUsd, locale),
                    )
                  : ""}
                {balance.initialBalanceUsd != null && balance.totalRechargesUsd > 0 ? " · " : ""}
                {balance.totalRechargesUsd > 0
                  ? t("superAdmin.openAiApiCreditBalanceRecharges").replace(
                      "{amount}",
                      formatUsdAmount(balance.totalRechargesUsd, locale),
                    )
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("superAdmin.openAiApiCreditBalanceConsumed")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {formatUsdAmount(balance.totalConsumedUsd, locale)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t("superAdmin.openAiDataSourceOpenAi")}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              {t("superAdmin.openAiApiCreditBalanceFormula")}
            </p>
            <p className="mt-1 text-sm font-medium text-emerald-900">{t("superAdmin.openAiApiCreditBalanceFormulaText")}</p>
          </div>
        </div>

        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
          {t("superAdmin.openAiApiCreditBalanceDisclaimer")}
        </p>
      </div>
    </SuperAdminPanel>
  );
}

export function SuperAdminOpenAiPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";

  const [panelTab, setPanelTab] = useState<OpenAiPanelTab>("monitoring");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [settings, setSettings] = useState<OpenAiSettings | null>(null);
  const [adminApiKey, setAdminApiKey] = useState("");
  const [initialBalanceUsd, setInitialBalanceUsd] = useState("");
  const [data, setData] = useState<OpenAiDashboardResponse | null>(null);

  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [projectId, setProjectId] = useState("");

  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeDate, setRechargeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rechargeNote, setRechargeNote] = useState("");
  const [rechargeSaving, setRechargeSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await api.get<OpenAiSettings>("/super/billing/ai-credits/openai/settings");
    setSettings(res);
    setInitialBalanceUsd(res.initialBalanceUsd ?? "");
  }, []);

  const loadDashboard = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("chartRange", chartRange);
    if (projectId.trim()) params.set("projectId", projectId.trim());
    const res = await api.get<OpenAiDashboardResponse>(`/super/billing/ai-credits/openai/dashboard?${params}`);
    setData(res);
  }, [chartRange, projectId]);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadSettings(), loadDashboard()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiLoadError"));
    } finally {
      setLoading(false);
    }
  }, [loadDashboard, loadSettings, t]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    if (loading || panelTab !== "monitoring") return;
    void loadDashboard().catch(() => undefined);
  }, [chartRange, projectId, loading, loadDashboard, panelTab]);

  const chartData = useMemo(
    () =>
      (data?.dashboard.chart.daily ?? []).map((d) => ({
        name: d.date.slice(5),
        cost: d.amountUsd,
      })),
    [data?.dashboard.chart.daily],
  );

  const isConfigured = Boolean(settings?.configured);
  const isSynced = Boolean(data?.dashboard.syncedAt ?? settings?.lastSyncedAt);
  const lastSyncAt = data?.dashboard.syncedAt ?? settings?.lastSyncedAt ?? null;

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload: { adminApiKey?: string; initialBalanceUsd?: number | null } = {};
      if (adminApiKey.trim() && adminApiKey.trim() !== MASKED_KEY && !adminApiKey.includes("•")) {
        payload.adminApiKey = adminApiKey.trim();
      }
      payload.initialBalanceUsd = initialBalanceUsd.trim()
        ? Number.parseFloat(initialBalanceUsd)
        : null;
      const res = await api.put<OpenAiSettings>("/super/billing/ai-credits/openai/settings", payload);
      setSettings(res);
      setAdminApiKey("");
      setSuccess(t("superAdmin.openAiSettingsSaved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiSettingsSaveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        "/super/billing/ai-credits/openai/test-connection",
        {},
      );
      setSuccess(typeof res.message === "string" ? res.message : t("superAdmin.openAiStatusConnected"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiConnectionError"));
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/super/billing/ai-credits/openai/sync", {});
      setSuccess(t("superAdmin.openAiSyncSuccess"));
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiSyncError"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleRegisterRecharge(e: FormEvent) {
    e.preventDefault();
    const amount = Number.parseFloat(rechargeAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setRechargeSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.post("/super/billing/ai-credits/openai/recharges", {
        amountUsd: amount,
        rechargedAt: new Date(`${rechargeDate}T12:00:00.000Z`).toISOString(),
        note: rechargeNote.trim() || null,
      });
      setRechargeAmount("");
      setRechargeNote("");
      setSuccess(t("superAdmin.openAiRechargeSaved"));
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiRechargeError"));
    } finally {
      setRechargeSaving(false);
    }
  }

  async function handleCancelRecharge(id: string) {
    setError("");
    try {
      await api.post(`/super/billing/ai-credits/openai/recharges/${id}/cancel`, {});
      setSuccess(t("superAdmin.openAiRechargeCancelled"));
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.openAiRechargeError"));
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{t("superAdmin.openAiTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{t("superAdmin.openAiSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["monitoring", "settings"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPanelTab(id);
                setError("");
                setSuccess("");
              }}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                panelTab === id
                  ? "bg-brand-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {id === "monitoring" ? <Activity className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
              {t(`superAdmin.openAiTab_${id}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? <AlertBanner tone="error">{error}</AlertBanner> : null}
      {success ? <AlertBanner tone="success">{success}</AlertBanner> : null}

      {panelTab === "settings" ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <SectionHeader
            icon={Settings2}
            title={t("superAdmin.openAiConfigTitle")}
            subtitle={t("superAdmin.openAiConfigIntro")}
          />
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span
                className={clsx(
                  "inline-flex h-2.5 w-2.5 rounded-full",
                  isConfigured ? "bg-emerald-500" : "bg-slate-300",
                )}
              />
              <span className="text-sm text-slate-700">
                {isConfigured ? t("superAdmin.openAiStatusConfigured") : t("superAdmin.openAiStatusDisconnected")}
              </span>
              {settings?.adminApiKeyMasked ? (
                <code className="rounded bg-white px-2 py-1 text-xs text-slate-600">{settings.adminApiKeyMasked}</code>
              ) : null}
            </div>

            <form className="grid gap-5 lg:grid-cols-2" onSubmit={(e) => void handleSaveSettings(e)}>
              <div className="min-w-0 lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiAdminKey")}</label>
                <input
                  type="password"
                  className="input-field mt-1 w-full font-mono"
                  value={adminApiKey}
                  onChange={(e) => setAdminApiKey(e.target.value)}
                  placeholder={settings?.adminApiKeyMasked || t("superAdmin.openAiAdminKeyPlaceholder")}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-slate-500">{t("superAdmin.openAiAdminKeyHint")}</p>
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiInitialBalance")}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input-field mt-1 w-full"
                  value={initialBalanceUsd}
                  onChange={(e) => setInitialBalanceUsd(e.target.value)}
                  placeholder="100.00"
                />
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{t("superAdmin.openAiInitialBalanceHint")}</p>
              </div>
              <div className="flex flex-wrap items-end gap-2 lg:justify-end">
                <button type="button" className="btn-secondary" disabled={testing} onClick={() => void handleTestConnection()}>
                  {testing ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                  {t("superAdmin.openAiTestConnection")}
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </SuperAdminPanel>
      ) : null}

      {panelTab === "monitoring" ? (
        <>
          <SuperAdminPanel className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    isSynced
                      ? "bg-emerald-100 text-emerald-800"
                      : isConfigured
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600",
                  )}
                >
                  {isSynced ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {isSynced
                    ? t("superAdmin.openAiStatusConnected")
                    : isConfigured
                      ? t("superAdmin.openAiStatusAwaitingSync")
                      : t("superAdmin.openAiStatusDisconnected")}
                </span>
                <span className="text-xs text-slate-500">
                  {t("superAdmin.openAiLastSync")}: {formatDateTime(lastSyncAt, localeTag)}
                </span>
              </div>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5"
                disabled={syncing || !isConfigured}
                onClick={() => void handleSync()}
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("superAdmin.openAiRefreshData")}
              </button>
            </div>
          </SuperAdminPanel>

          {data?.dashboard.stale && !loading ? (
            <AlertBanner tone="warning">{t("superAdmin.openAiNoDataYet")}</AlertBanner>
          ) : null}

          {data?.dashboard.syncError ? (
            <AlertBanner tone="warning">{t("superAdmin.openAiSyncError")}</AlertBanner>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : data ? (
            <div className="space-y-5">
              <ApiCreditBalancePanel
                balance={data.dashboard.apiCreditBalance}
                syncedAt={data.dashboard.syncedAt}
                locale={localeTag}
                t={t}
                onConfigure={() => setPanelTab("settings")}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <MetricCard
                  label={t("superAdmin.openAiCostToday")}
                  value={formatUsdAmount(data.dashboard.costs.todayUsd, localeTag)}
                  footer={t("superAdmin.openAiDataSourceOpenAi")}
                />
                <MetricCard
                  label={t("superAdmin.openAiCostMonth")}
                  value={formatUsdAmount(data.dashboard.costs.monthUsd, localeTag)}
                  footer={t("superAdmin.openAiDataSourceOpenAi")}
                />
                <MetricCard
                  label={t("superAdmin.openAiCostLast30")}
                  value={formatUsdAmount(data.dashboard.costs.last30DaysUsd, localeTag)}
                  footer={t("superAdmin.openAiDataSourceOpenAi")}
                />
              </div>

              <SuperAdminPanel className="overflow-hidden p-0">
                <SectionHeader
                  icon={TrendingUp}
                  title={t("superAdmin.openAiChartTitle")}
                  subtitle={t("superAdmin.openAiDataSourceOpenAi")}
                  action={
                    <div className="flex flex-wrap gap-2">
                      {(["7d", "30d", "month"] as const).map((range) => (
                        <button
                          key={range}
                          type="button"
                          className={clsx(
                            "rounded-lg px-3 py-1.5 text-xs font-medium",
                            chartRange === range
                              ? "bg-brand-600 text-white"
                              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                          )}
                          onClick={() => setChartRange(range)}
                        >
                          {t(`superAdmin.openAiChartRange_${range}`)}
                        </button>
                      ))}
                    </div>
                  }
                />
                {data.dashboard.projects.length > 0 ? (
                  <div className="border-b border-slate-200 px-5 py-3">
                    <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiProjectFilter")}</label>
                    <select
                      className="input-field mt-1 w-full max-w-lg"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">{t("superAdmin.openAiAllProjects")}</option>
                      {data.dashboard.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} ({formatUsdAmount(p.amountUsd, localeTag)})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="min-w-0 p-5">
                  <MeasuredResponsiveContainer className="h-80 w-full min-w-0" minHeight={320}>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="openAiCostGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis
                        width={56}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        formatter={(value) =>
                          formatUsdAmount(typeof value === "number" ? value : Number(value ?? 0), localeTag)
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#openAiCostGradient)"
                        name={t("superAdmin.openAiChartTitle")}
                      />
                    </AreaChart>
                  </MeasuredResponsiveContainer>
                </div>
              </SuperAdminPanel>

              <SuperAdminPanel className="overflow-hidden p-0">
                <SectionHeader
                  icon={Wallet}
                  title={t("superAdmin.openAiProfitabilityTitle")}
                  subtitle={t("superAdmin.openAiProfitabilityHint")}
                />
                <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
                  <MetricCard
                    label={t("superAdmin.openAiCreditsConsumed")}
                    value={formatBrlAmount(data.profitability.creditsConsumedBrl, localeTag)}
                    footer={t("superAdmin.openAiDataSourcePlatform")}
                  />
                  <MetricCard
                    label={t("superAdmin.openAiCostConverted")}
                    value={formatBrlAmount(data.profitability.openAiCostBrl, localeTag)}
                    footer={t("superAdmin.openAiFxRate").replace("{rate}", data.profitability.usdBrlRate.toFixed(2))}
                  />
                  <MetricCard
                    label={t("superAdmin.openAiGrossMargin")}
                    value={formatBrlAmount(data.profitability.marginBrl, localeTag)}
                    footer={t("superAdmin.openAiDataSourcePlatform")}
                    accent="emerald"
                  />
                </div>
              </SuperAdminPanel>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <SuperAdminPanel className="min-w-0 overflow-hidden p-0">
                  <SectionHeader icon={Activity} title={t("superAdmin.openAiDetailTitle")} />
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">{t("superAdmin.openAiColDate")}</th>
                          <th className="px-4 py-3 font-medium">{t("superAdmin.openAiColCategory")}</th>
                          <th className="px-4 py-3 text-right font-medium">{t("superAdmin.openAiColCost")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dashboard.detail.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                              {t("superAdmin.openAiDetailEmpty")}
                            </td>
                          </tr>
                        ) : (
                          data.dashboard.detail.slice(0, 100).map((row, idx) => (
                            <tr key={`${row.date}-${row.category}-${idx}`} className="border-t border-slate-100">
                              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{row.date}</td>
                              <td className="max-w-[220px] truncate px-4 py-3 text-slate-700" title={row.category}>
                                {row.category}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                                {formatUsdAmount(row.amountUsd, localeTag)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </SuperAdminPanel>

                <SuperAdminPanel className="min-w-0 overflow-hidden p-0">
                  <SectionHeader
                    icon={Zap}
                    title={t("superAdmin.openAiRechargesTitle")}
                    subtitle={t("superAdmin.openAiRechargesHint")}
                  />
                  <div className="space-y-4 p-5">
                    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => void handleRegisterRecharge(e)}>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiRechargeAmount")}</label>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          className="input-field mt-1 w-full"
                          value={rechargeAmount}
                          onChange={(e) => setRechargeAmount(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiColDate")}</label>
                        <input
                          type="date"
                          required
                          className="input-field mt-1 w-full"
                          value={rechargeDate}
                          onChange={(e) => setRechargeDate(e.target.value)}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiRechargeNote")}</label>
                        <input
                          type="text"
                          className="input-field mt-1 w-full"
                          value={rechargeNote}
                          onChange={(e) => setRechargeNote(e.target.value)}
                          placeholder={t("superAdmin.openAiRechargeNotePlaceholder")}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button type="submit" className="btn-primary" disabled={rechargeSaving}>
                          {rechargeSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                          {t("superAdmin.openAiRegisterRecharge")}
                        </button>
                      </div>
                    </form>

                    <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[360px] text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">{t("superAdmin.openAiColDate")}</th>
                            <th className="px-3 py-2 font-medium">{t("superAdmin.openAiColCost")}</th>
                            <th className="px-3 py-2 font-medium">{t("superAdmin.openAiRechargeNote")}</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {data.dashboard.recharges.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                                {t("superAdmin.openAiRechargesEmpty")}
                              </td>
                            </tr>
                          ) : (
                            data.dashboard.recharges.map((row) => (
                              <tr key={row.id} className="border-t border-slate-100">
                                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                                  {formatDateTime(row.rechargedAt, localeTag)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                                  {formatUsdAmount(Number.parseFloat(row.amountUsd), localeTag)}
                                </td>
                                <td className="max-w-[160px] truncate px-3 py-2 text-slate-700" title={row.note ?? undefined}>
                                  {row.note || "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.status === "active" ? (
                                    <button
                                      type="button"
                                      className="text-xs font-medium text-red-600 hover:underline"
                                      onClick={() => void handleCancelRecharge(row.id)}
                                    >
                                      {t("superAdmin.openAiCancelRecharge")}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-slate-400">{row.status}</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </SuperAdminPanel>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
