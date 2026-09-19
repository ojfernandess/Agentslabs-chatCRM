import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import clsx from "clsx";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { MeasuredResponsiveContainer } from "@/components/charts/MeasuredResponsiveContainer";

type ChartRange = "7d" | "30d" | "month" | "custom";

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
    chart: { range: ChartRange; from: string; to: string; daily: { date: string; amountUsd: number }[] };
    detail: { date: string; category: string; projectId: string | null; amountUsd: number }[];
    projects: { id: string; amountUsd: number }[];
    usage: {
      date: string;
      model: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      requests: number;
      projectId: string | null;
    }[];
    recharges: { id: string; amountUsd: string; rechargedAt: string; note: string | null; status: string }[];
    settings: { initialBalanceUsd: string | null };
  };
  profitability: {
    source: "platform";
    usdBrlRate: number;
    creditsConsumedBrl: string;
    openAiCostUsd: string;
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

function CostCard({ label, value, locale }: { label: string; value: number; locale: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatUsdAmount(value, locale)}</p>
      <p className="mt-1 text-xs text-slate-500">OpenAI</p>
    </div>
  );
}

export function SuperAdminOpenAiPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";

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
  const [chartFrom, setChartFrom] = useState("");
  const [chartTo, setChartTo] = useState("");

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
    if (chartRange === "custom") {
      if (chartFrom) params.set("chartFrom", chartFrom);
      if (chartTo) params.set("chartTo", chartTo);
    }
    const res = await api.get<OpenAiDashboardResponse>(`/super/billing/ai-credits/openai/dashboard?${params}`);
    setData(res);
  }, [chartFrom, chartRange, chartTo, projectId]);

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
    if (loading) return;
    void loadDashboard().catch(() => undefined);
  }, [chartRange, projectId, chartFrom, chartTo, loading, loadDashboard]);

  const chartData = useMemo(
    () =>
      (data?.dashboard.chart.daily ?? []).map((d) => ({
        name: d.date.slice(8, 10),
        cost: d.amountUsd,
      })),
    [data?.dashboard.chart.daily],
  );

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload: { adminApiKey?: string; initialBalanceUsd?: number | null } = {};
      if (adminApiKey.trim() && adminApiKey.trim() !== MASKED_KEY) {
        payload.adminApiKey = adminApiKey.trim();
      }
      if (initialBalanceUsd.trim()) {
        payload.initialBalanceUsd = Number.parseFloat(initialBalanceUsd);
      } else {
        payload.initialBalanceUsd = null;
      }
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
      setSuccess(res.message);
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

  const connected = settings?.configured && (settings.connected || Boolean(data?.dashboard.syncedAt));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t("superAdmin.openAiTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("superAdmin.openAiSubtitle")}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <SuperAdminPanel>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.openAiConfigTitle")}</h3>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className={clsx(
                  "inline-block h-2 w-2 rounded-full",
                  connected ? "bg-emerald-500" : "bg-slate-300",
                )}
              />
              <span className="text-slate-600">
                {connected ? t("superAdmin.openAiStatusConnected") : t("superAdmin.openAiStatusDisconnected")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t("superAdmin.openAiLastSync")}: {formatDateTime(data?.dashboard.syncedAt ?? settings?.lastSyncedAt ?? null, localeTag)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={testing} onClick={() => void handleTestConnection()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("superAdmin.openAiTestConnection")}
            </button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={syncing} onClick={() => void handleSync()}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("superAdmin.openAiRefreshData")}
            </button>
          </div>
        </div>

        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(e) => void handleSaveSettings(e)}>
          <div>
            <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiAdminKey")}</label>
            <input
              type="password"
              className="input-field mt-1 font-mono"
              value={adminApiKey}
              onChange={(e) => setAdminApiKey(e.target.value)}
              placeholder={settings?.adminApiKeyMasked || t("superAdmin.openAiAdminKeyPlaceholder")}
              autoComplete="off"
            />
            {settings?.adminApiKeyMasked ? (
              <p className="mt-1 text-xs text-slate-500">{settings.adminApiKeyMasked}</p>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiInitialBalance")}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input-field mt-1"
              value={initialBalanceUsd}
              onChange={(e) => setInitialBalanceUsd(e.target.value)}
              placeholder="100.00"
            />
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.openAiInitialBalanceHint")}</p>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </button>
          </div>
        </form>
      </SuperAdminPanel>

      {data?.dashboard.stale && !loading ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("superAdmin.openAiNoDataYet")}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <CostCard label={t("superAdmin.openAiCostToday")} value={data.dashboard.costs.todayUsd} locale={localeTag} />
            <CostCard label={t("superAdmin.openAiCostMonth")} value={data.dashboard.costs.monthUsd} locale={localeTag} />
            <CostCard
              label={t("superAdmin.openAiCostLast30")}
              value={data.dashboard.costs.last30DaysUsd}
              locale={localeTag}
            />
          </div>

          {data.dashboard.estimatedBalanceUsd != null ? (
            <SuperAdminPanel>
              <div className="flex items-start gap-3">
                <Zap className="mt-0.5 h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("superAdmin.openAiEstimatedBalance")}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                    ≈ {formatUsdAmount(data.dashboard.estimatedBalanceUsd, localeTag)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500" title={t("superAdmin.openAiEstimatedBalanceTooltip")}>
                    {t("superAdmin.openAiEstimatedBalanceHint")}
                  </p>
                </div>
              </div>
            </SuperAdminPanel>
          ) : null}

          <SuperAdminPanel className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.openAiChartTitle")}</h3>
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
            </div>
            {data.dashboard.projects.length > 0 ? (
              <div className="border-b border-slate-200 px-4 py-3">
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiProjectFilter")}</label>
                <select
                  className="input-field mt-1 max-w-md"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">{t("superAdmin.openAiAllProjects")}</option>
                  {data.dashboard.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id.slice(0, 8)}… ({formatUsdAmount(p.amountUsd, localeTag)})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="p-4">
              <MeasuredResponsiveContainer className="h-72 w-full min-w-0" minHeight={288}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="openAiCostGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#64748b" }}
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
              <p className="mt-2 text-xs text-slate-500">{t("superAdmin.openAiDataSourceOpenAi")}</p>
            </div>
          </SuperAdminPanel>

          <SuperAdminPanel>
            <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.openAiProfitabilityTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.openAiProfitabilityHint")}</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("superAdmin.openAiCreditsConsumed")}
                </p>
                <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">
                  {formatBrlAmount(data.profitability.creditsConsumedBrl, localeTag)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{t("superAdmin.openAiDataSourcePlatform")}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("superAdmin.openAiCostConverted")}
                </p>
                <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">
                  {formatBrlAmount(data.profitability.openAiCostBrl, localeTag)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("superAdmin.openAiFxRate").replace("{rate}", data.profitability.usdBrlRate.toFixed(2))}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("superAdmin.openAiGrossMargin")}
                </p>
                <p className="mt-2 text-xl font-bold tabular-nums text-emerald-700">
                  {formatBrlAmount(data.profitability.marginBrl, localeTag)}
                </p>
              </div>
            </div>
          </SuperAdminPanel>

          <SuperAdminPanel className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.openAiDetailTitle")}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{t("superAdmin.openAiColDate")}</th>
                    <th className="px-4 py-3">{t("superAdmin.openAiColCategory")}</th>
                    <th className="px-4 py-3 text-right">{t("superAdmin.openAiColCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dashboard.detail.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                        {t("superAdmin.openAiDetailEmpty")}
                      </td>
                    </tr>
                  ) : (
                    data.dashboard.detail.slice(0, 100).map((row, idx) => (
                      <tr key={`${row.date}-${row.category}-${idx}`} className="border-t border-slate-100">
                        <td className="px-4 py-3 tabular-nums">{row.date}</td>
                        <td className="px-4 py-3">{row.category}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatUsdAmount(row.amountUsd, localeTag)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SuperAdminPanel>

          <SuperAdminPanel>
            <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.openAiRechargesTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.openAiRechargesHint")}</p>
            <form className="mt-4 grid gap-3 sm:grid-cols-4" onSubmit={(e) => void handleRegisterRecharge(e)}>
              <div>
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiRechargeAmount")}</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  className="input-field mt-1"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiColDate")}</label>
                <input
                  type="date"
                  required
                  className="input-field mt-1"
                  value={rechargeDate}
                  onChange={(e) => setRechargeDate(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600">{t("superAdmin.openAiRechargeNote")}</label>
                <input
                  type="text"
                  className="input-field mt-1"
                  value={rechargeNote}
                  onChange={(e) => setRechargeNote(e.target.value)}
                  placeholder={t("superAdmin.openAiRechargeNotePlaceholder")}
                />
              </div>
              <div className="sm:col-span-4">
                <button type="submit" className="btn-primary" disabled={rechargeSaving}>
                  {rechargeSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}
                  {t("superAdmin.openAiRegisterRecharge")}
                </button>
              </div>
            </form>
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{t("superAdmin.openAiColDate")}</th>
                    <th className="px-4 py-3">{t("superAdmin.openAiColCost")}</th>
                    <th className="px-4 py-3">{t("superAdmin.openAiRechargeNote")}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.dashboard.recharges.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                        {t("superAdmin.openAiRechargesEmpty")}
                      </td>
                    </tr>
                  ) : (
                    data.dashboard.recharges.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-4 py-3">{formatDateTime(row.rechargedAt, localeTag)}</td>
                        <td className="px-4 py-3 tabular-nums">{formatUsdAmount(Number.parseFloat(row.amountUsd), localeTag)}</td>
                        <td className="px-4 py-3">{row.note || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {row.status === "active" ? (
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
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
          </SuperAdminPanel>
        </>
      ) : null}
    </div>
  );
}
