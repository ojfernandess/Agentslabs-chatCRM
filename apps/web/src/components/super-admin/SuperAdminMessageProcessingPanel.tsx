import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminMetricCard, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type OrgInbox = { id: string; name: string; channelType: string };
type OrgOption = { id: string; name: string; inboxes: OrgInbox[] };

type ResourceSnapshot = {
  processCpuPercent: number;
  serverCpuPercent: number | null;
  processMemoryMb: number;
  serverMemoryUsedMb: number | null;
  serverMemoryTotalMb: number | null;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  eventLoopLagMs: number;
  eventLoopUtilization: number | null;
};

type TraceSpan = {
  stage: string;
  label: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cpuDeltaPercent: number;
};

type MessageTrace = {
  traceId: string;
  environment: string;
  direction: "INBOUND" | "OUTBOUND";
  organizationId: string;
  organizationName?: string;
  inboxId?: string;
  inboxName?: string;
  provider?: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  errorMessage?: string;
  snapshots: {
    before: ResourceSnapshot;
    peak: ResourceSnapshot;
    after?: ResourceSnapshot;
  };
  spans: TraceSpan[];
  querySummary: {
    total: number;
    totalDurationMs: number;
    slowestMs: number;
    repeatedPatterns: Array<{ pattern: string; count: number }>;
  };
  realtime: { emits: number; recipients: number; payloadBytes: number };
  bot: { triggered: boolean; durationMs?: number };
  meta: { sendAttempts: number; lastError?: string; wamid?: string };
  anomalies: Array<{ code: string; severity: string; message: string }>;
  events: Array<{ name: string; count: number }>;
};

type OverviewResponse = {
  enabled: boolean;
  overview: {
    environment: string;
    session: {
      active: boolean;
      investigationUntil: string | null;
      samplingPercent: number;
      organizationId: string | null;
      inboxId: string | null;
      direction: string;
    };
    system: ResourceSnapshot & {
      cpuCores: number;
      processingNow: number;
      messagesMonitored: number;
      errors: number;
      peakProcessCpuPercent: number;
      peakEventLoopLagMs: number;
    };
  };
};

type TabId = "messages" | "bottlenecks" | "anomalies";

function envBadgeClass(env: string): string {
  if (env === "production") return "bg-rose-100 text-rose-800 ring-rose-200";
  if (env === "staging") return "bg-amber-100 text-amber-800 ring-amber-200";
  return "bg-sky-100 text-sky-800 ring-sky-200";
}

function formatMs(ms: number | undefined, locale: string): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function withQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale === "en" ? "en-US" : "pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function SuperAdminMessageProcessingPanel() {
  const { t, locale } = useI18n();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [direction, setDirection] = useState<"ALL" | "INBOUND" | "OUTBOUND">("ALL");
  const [fetchFailedOnly, setFetchFailedOnly] = useState(false);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [traces, setTraces] = useState<MessageTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<MessageTrace | null>(null);
  const [bottlenecks, setBottlenecks] = useState<Array<{ stage: string; totalMs: number; percent: number }>>([]);
  const [anomalies, setAnomalies] = useState<Array<{ code: string; message: string; at: string; severity: string }>>([]);
  const [tab, setTab] = useState<TabId>("messages");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [investigationMinutes, setInvestigationMinutes] = useState(5);
  const [starting, setStarting] = useState(false);

  const selectedOrg = useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId]);
  const inboxes = selectedOrg?.inboxes ?? [];

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, tracesRes, bnRes, anRes] = await Promise.all([
        api.get<OverviewResponse>("/super/message-processing/status"),
        api.get<{ traces: MessageTrace[] }>(
          withQuery("/super/message-processing/traces", {
            organizationId: orgId || undefined,
            inboxId: inboxId || undefined,
            direction: direction === "ALL" ? undefined : direction,
            fetchFailedOnly: fetchFailedOnly || undefined,
            limit: 100,
            windowMinutes: 60,
          }),
        ),
        api.get<{ stages: Array<{ stage: string; totalMs: number; percent: number }> }>(
          withQuery("/super/message-processing/bottlenecks", { windowMinutes: 60 }),
        ),
        api.get<{ anomalies: Array<{ code: string; message: string; at: string; severity: string }> }>(
          withQuery("/super/message-processing/anomalies", { limit: 50 }),
        ),
      ]);
      setOverview(statusRes);
      setTraces(tracesRes.traces);
      setBottlenecks(bnRes.stages ?? []);
      setAnomalies(anRes.anomalies ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.messageProcessing.loadError"));
    } finally {
      setLoading(false);
    }
  }, [orgId, inboxId, direction, fetchFailedOnly, t]);

  useEffect(() => {
    void api
      .get<{ organizations: OrgOption[] }>("/super/message-processing/organizations")
      .then((r) => setOrgs(r.organizations))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => void loadAll(), 5000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const startInvestigation = async () => {
    setStarting(true);
    try {
      await api.post("/super/message-processing/session/start", {
        organizationId: orgId || null,
        inboxId: inboxId || null,
        direction,
        durationMinutes: investigationMinutes,
        samplingPercent: 100,
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.messageProcessing.startError"));
    } finally {
      setStarting(false);
    }
  };

  const stopInvestigation = async () => {
    try {
      await api.post("/super/message-processing/session/stop");
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.messageProcessing.stopError"));
    }
  };

  const openTrace = async (traceId: string) => {
    try {
      const res = await api.get<{ trace: MessageTrace }>(`/super/message-processing/traces/${traceId}`);
      setSelectedTrace(res.trace);
    } catch {
      setError(t("superAdmin.messageProcessing.traceNotFound"));
    }
  };

  const exportTrace = (traceId: string, format: "json" | "csv") => {
    window.open(`/api/v1/super/message-processing/traces/${traceId}/export?format=${format}`, "_blank");
  };

  const sys = overview?.overview.system;
  const session = overview?.overview.session;
  const env = overview?.overview.environment ?? "development";
  const cpuCores = sys?.cpuCores ?? 1;
  const processCpuCap = cpuCores * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{t("superAdmin.messageProcessing.title")}</h1>
            <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", envBadgeClass(env))}>
              {t(`superAdmin.messageProcessing.env.${env}`)}
            </span>
            {session?.active ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                {t("superAdmin.messageProcessing.monitoringActive")}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                {t("superAdmin.messageProcessing.monitoringIdle")}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{t("superAdmin.messageProcessing.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            {t("superAdmin.messageProcessing.refresh")}
          </button>
          {session?.active ? (
            <button
              type="button"
              onClick={() => void stopInvestigation()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
            >
              <Square className="h-4 w-4" />
              {t("superAdmin.messageProcessing.stopInvestigation")}
            </button>
          ) : (
            <button
              type="button"
              disabled={starting}
              onClick={() => void startInvestigation()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t("superAdmin.messageProcessing.startInvestigation")}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <SuperAdminPanel className="p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("superAdmin.messageProcessing.organization")}
            </label>
            <select
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setInboxId("");
              }}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">{t("superAdmin.messageProcessing.allOrganizations")}</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("superAdmin.messageProcessing.inbox")}
            </label>
            <select
              value={inboxId}
              onChange={(e) => setInboxId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              disabled={!orgId}
            >
              <option value="">{t("superAdmin.messageProcessing.allInboxes")}</option>
              {inboxes.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("superAdmin.messageProcessing.direction")}
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="ALL">{t("superAdmin.messageProcessing.directionAll")}</option>
              <option value="INBOUND">{t("superAdmin.messageProcessing.directionInbound")}</option>
              <option value="OUTBOUND">{t("superAdmin.messageProcessing.directionOutbound")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {t("superAdmin.messageProcessing.investigationDuration")}
            </label>
            <select
              value={investigationMinutes}
              onChange={(e) => setInvestigationMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value={1}>1 {t("superAdmin.messageProcessing.minutes")}</option>
              <option value={5}>5 {t("superAdmin.messageProcessing.minutes")}</option>
              <option value={10}>10 {t("superAdmin.messageProcessing.minutes")}</option>
            </select>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={fetchFailedOnly}
            onChange={(e) => setFetchFailedOnly(e.target.checked)}
          />
          {t("superAdmin.messageProcessing.fetchFailedOnly")}
        </label>
      </SuperAdminPanel>

      {sys ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SuperAdminMetricCard
            label={t("superAdmin.messageProcessing.messagesMonitored")}
            value={sys.messagesMonitored}
            hint={`${t("superAdmin.messageProcessing.processingNow")}: ${sys.processingNow}`}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.messageProcessing.processCpu")}
            value={`${sys.processCpuPercent}%`}
            hint={`${t("superAdmin.messageProcessing.processCpuCap")}: ${processCpuCap}% (${cpuCores} cores)`}
            accent={sys.processCpuPercent >= 400 ? "amber" : "default"}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.messageProcessing.serverCpu")}
            value={sys.serverCpuPercent != null ? `${sys.serverCpuPercent}%` : "—"}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.messageProcessing.eventLoopLag")}
            value={`${sys.eventLoopLagMs}ms`}
            hint={sys.peakEventLoopLagMs > 250 ? `Pico: ${sys.peakEventLoopLagMs}ms` : undefined}
            accent={sys.eventLoopLagMs >= 250 ? "amber" : "default"}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.messageProcessing.errors")}
            value={sys.errors}
            accent={sys.errors > 0 ? "amber" : "default"}
          />
        </div>
      ) : null}

      <div className="flex gap-2 border-b border-slate-200">
        {(["messages", "bottlenecks", "anomalies"] as TabId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              tab === id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t(`superAdmin.messageProcessing.tab.${id}`)}
          </button>
        ))}
      </div>

      {loading && !traces.length ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t("superAdmin.messageProcessing.loading")}
        </div>
      ) : null}

      {tab === "messages" ? (
        <SuperAdminPanel className="overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colTime")}</th>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colDirection")}</th>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colTrace")}</th>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colDuration")}</th>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colCpu")}</th>
                <th className="px-4 py-3">{t("superAdmin.messageProcessing.colQueries")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {session?.active
                      ? t("superAdmin.messageProcessing.noTracesYet")
                      : t("superAdmin.messageProcessing.startToCapture")}
                  </td>
                </tr>
              ) : (
                traces.map((tr) => (
                  <tr key={tr.traceId} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 tabular-nums">{formatTime(tr.startedAt, locale)}</td>
                    <td className="px-4 py-3">
                      {tr.direction === "INBOUND" ? "↓" : "↑"} {tr.provider ?? "WhatsApp"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{tr.traceId}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMs(tr.totalDurationMs, locale)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {tr.snapshots.peak.processCpuPercent}%
                      {tr.snapshots.peak.processCpuPercent >= 400 ? " 🚨" : ""}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{tr.querySummary.total}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openTrace(tr.traceId)}
                        className="text-brand-600 hover:underline"
                      >
                        {t("superAdmin.messageProcessing.viewTrace")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SuperAdminPanel>
      ) : null}

      {tab === "bottlenecks" ? (
        <SuperAdminPanel className="p-4">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
            <Activity className="h-4 w-4" />
            {t("superAdmin.messageProcessing.bottlenecksTitle")}
          </h2>
          {bottlenecks.length === 0 ? (
            <p className="text-sm text-slate-500">{t("superAdmin.messageProcessing.noBottlenecks")}</p>
          ) : (
            <ol className="space-y-3">
              {bottlenecks.map((b, i) => (
                <li key={b.stage} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                  <span className="font-medium text-slate-800">
                    {i + 1}. {b.stage}
                  </span>
                  <span className="text-sm text-slate-600 tabular-nums">
                    {formatMs(b.totalMs, locale)} · {b.percent}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SuperAdminPanel>
      ) : null}

      {tab === "anomalies" ? (
        <SuperAdminPanel className="p-4">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("superAdmin.messageProcessing.anomaliesTitle")}
          </h2>
          {anomalies.length === 0 ? (
            <p className="text-sm text-slate-500">{t("superAdmin.messageProcessing.noAnomalies")}</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.map((a, idx) => (
                <li key={`${a.at}-${idx}`} className="rounded-lg border border-slate-100 px-4 py-3 text-sm">
                  <p className="font-medium text-slate-800">{a.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatTime(a.at, locale)} · {a.code}</p>
                </li>
              ))}
            </ul>
          )}
        </SuperAdminPanel>
      ) : null}

      {selectedTrace ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelectedTrace(null)}>
          <div
            className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <p className="font-mono text-sm text-slate-600">{selectedTrace.traceId}</p>
                <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.messageProcessing.traceDetail")}</h3>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => exportTrace(selectedTrace.traceId, "json")}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs"
                >
                  <Download className="h-3 w-3" /> JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportTrace(selectedTrace.traceId, "csv")}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                <button type="button" onClick={() => setSelectedTrace(null)} className="text-slate-500 hover:text-slate-800">
                  ✕
                </button>
              </div>
            </div>
            <div className="space-y-6 p-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.colDirection")}</dt>
                  <dd>{selectedTrace.direction}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.colDuration")}</dt>
                  <dd>{formatMs(selectedTrace.totalDurationMs, locale)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.peakCpu")}</dt>
                  <dd>{selectedTrace.snapshots.peak.processCpuPercent}%</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.eventLoopLag")}</dt>
                  <dd>{selectedTrace.snapshots.peak.eventLoopLagMs}ms</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.colQueries")}</dt>
                  <dd>{selectedTrace.querySummary.total}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("superAdmin.messageProcessing.realtimeEmits")}</dt>
                  <dd>{selectedTrace.realtime.emits}</dd>
                </div>
              </dl>

              {selectedTrace.anomalies.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p className="font-medium text-amber-900">{t("superAdmin.messageProcessing.detectedAnomalies")}</p>
                  <ul className="mt-2 list-disc pl-5 text-amber-800">
                    {selectedTrace.anomalies.map((a) => (
                      <li key={a.code + a.message}>{a.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <h4 className="mb-3 font-semibold text-slate-900">{t("superAdmin.messageProcessing.timeline")}</h4>
                <ol className="space-y-4 border-l-2 border-slate-200 pl-4">
                  {selectedTrace.spans.map((span) => (
                    <li key={`${span.stage}-${span.startedAt}`}>
                      <p className="text-xs tabular-nums text-slate-500">{formatTime(span.startedAt, locale)}</p>
                      <p className="font-medium text-slate-800">{span.label}</p>
                      <p className="text-xs text-slate-600">
                        {span.durationMs}ms · CPU observada +{span.cpuDeltaPercent}%
                        {span.durationMs >= 1000 ? " 🚨" : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              {selectedTrace.querySummary.repeatedPatterns.length > 0 ? (
                <div>
                  <h4 className="mb-2 font-semibold text-slate-900">{t("superAdmin.messageProcessing.repeatedQueries")}</h4>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {selectedTrace.querySummary.repeatedPatterns.map((p) => (
                      <li key={p.pattern}>
                        {p.pattern}: {p.count}x
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
