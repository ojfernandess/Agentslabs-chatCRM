import { useEffect, useMemo, useState, type ReactNode } from "react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import clsx from "clsx";
import { Info, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "@/components/Motion";
import { MeasuredResponsiveContainer } from "@/components/charts/MeasuredResponsiveContainer";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { resolveUserAvatarUrl } from "@/lib/userAvatar";

type Granularity = "day" | "week" | "month";

export type AgentPerformanceDetailPayload = {
  meta: {
    from: string;
    to: string;
    granularity: Granularity;
    csatEnabled: boolean;
    slaConfigured: boolean;
    presenceDataAvailable: boolean;
  };
  agent: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    teamNames: string[];
    availabilityStatus: "online" | "away" | "offline" | null;
  };
  overview: {
    received: number;
    completed: number;
    inProgress: number;
    pending: number;
    resolutionRatePct: number | null;
  };
  times: {
    avgFirstResponseSec: number | null;
    avgResponseSec: number | null;
    avgHandleSec: number | null;
    avgResolutionSec: number | null;
    sampleFirstResponse: number;
    sampleResponse: number;
    sampleHandle: number;
    sampleResolution: number;
  };
  sla: {
    configured: boolean;
    withinPct: number | null;
    violated: number | null;
    evaluated: number;
  };
  csat: {
    enabled: boolean;
    average: number | null;
    responses: number;
  };
  quality: {
    reopenings: number;
    reopenRatePct: number | null;
    transfers: number;
    transferRatePct: number | null;
  };
  productivity: {
    messagesSent: number;
    uniqueClients: number;
    onlineTimeSec: null;
    handleTimeSec: null;
  };
  byChannel: Array<{
    channelType: string;
    received: number;
    completed: number;
    avgFirstResponseSec: number | null;
    avgResponseSec: number | null;
    resolutionRatePct: number | null;
    csatAverage: number | null;
    csatResponses: number;
  }>;
  timeSeries: Array<{ bucket: string; received: number; completed: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
};

type Props = {
  open: boolean;
  userId: string | null;
  agentName: string;
  fromStr: string;
  toStr: string;
  granularity: Granularity;
  onClose: () => void;
};

function formatDurationSec(sec: number | null, na: string): string {
  if (sec == null || !Number.isFinite(sec)) return na;
  const total = Math.max(0, Math.round(sec));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPct(v: number | null, na: string): string {
  if (v == null || !Number.isFinite(v)) return na;
  return `${Math.round(v * 10) / 10}%`;
}

function formatCsat(avg: number | null, na: string): string {
  if (avg == null || !Number.isFinite(avg)) return na;
  return `${Math.round(avg * 10) / 10} / 5 ★`;
}

function MetricCard({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/60">
      <div className="flex items-start gap-1.5">
        <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
        {tip ? (
          <span className="group relative inline-flex">
            <Info className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-[11px] font-normal leading-snug text-ink-600 shadow-lg group-hover:block dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200">
              {tip}
            </span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{title}</h3>
      {children}
    </section>
  );
}

export function AgentPerformanceDetailDrawer({
  open,
  userId,
  agentName,
  fromStr,
  toStr,
  granularity,
  onClose,
}: Props) {
  const { t, dateLocale } = useI18n();
  const na = t("reportsPage.na");
  const [data, setData] = useState<AgentPerformanceDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !userId) {
      setData(null);
      setError(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const from = startOfDay(parseISO(fromStr));
        const to = endOfDay(parseISO(toStr));
        const params = new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
          granularity,
        });
        const res = await api.get<AgentPerformanceDetailPayload>(`/reports/agents/${userId}?${params.toString()}`);
        if (!cancelled) setData(res);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setData(null);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, userId, fromStr, toStr, granularity]);

  const periodLabel = useMemo(() => {
    try {
      const from = format(parseISO(fromStr), "dd/MM/yyyy", { locale: dateLocale });
      const to = format(parseISO(toStr), "dd/MM/yyyy", { locale: dateLocale });
      return `${from} – ${to}`;
    } catch {
      return `${fromStr} – ${toStr}`;
    }
  }, [fromStr, toStr, dateLocale]);

  const chartData = useMemo(() => {
    if (!data?.timeSeries.length) return [];
    return data.timeSeries.map((row) => ({
      ...row,
      label: format(parseISO(row.bucket), data.meta.granularity === "month" ? "MMM yyyy" : "d MMM", {
        locale: dateLocale,
      }),
    }));
  }, [data, dateLocale]);

  const channelLabel = (channelType: string) => {
    const key = `inboxes.channelTypes.${channelType}` as "inboxes.channelTypes.WHATSAPP";
    const translated = t(key);
    return translated !== key ? translated : channelType;
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      completed: t("reportsPage.agentDetailStatusCompleted"),
      in_progress: t("reportsPage.agentDetailStatusInProgress"),
      pending: t("reportsPage.agentDetailStatusPending"),
      transferred: t("reportsPage.agentDetailStatusTransferred"),
    };
    return map[status] ?? status;
  };

  const availabilityLabel = (status: AgentPerformanceDetailPayload["agent"]["availabilityStatus"]) => {
    if (status === "online") return t("reportsPage.agentDetailAvailabilityOnline");
    if (status === "away") return t("reportsPage.agentDetailAvailabilityAway");
    if (status === "offline") return t("reportsPage.agentDetailAvailabilityOffline");
    return null;
  };

  const displayName = data?.agent.name ?? agentName;
  const avatarSrc = resolveUserAvatarUrl(data?.agent.avatarUrl);

  return (
    <AnimatePresence>
      {open && userId ? (
        <>
          <motion.button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[70] flex h-full w-full max-w-3xl flex-col border-l border-slate-200/80 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-950"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-500/15 text-lg font-bold text-brand-600 dark:text-brand-400">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-ink-900 dark:text-ink-50">{displayName}</h2>
                {data?.agent.teamNames.length ? (
                  <p className="truncate text-sm text-ink-500 dark:text-ink-400">{data.agent.teamNames.join(" · ")}</p>
                ) : null}
                {data?.agent.availabilityStatus ? (
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                    <span
                      className={clsx(
                        "mr-1.5 inline-block h-2 w-2 rounded-full",
                        data.agent.availabilityStatus === "online"
                          ? "bg-emerald-500"
                          : data.agent.availabilityStatus === "away"
                            ? "bg-amber-500"
                            : "bg-ink-400",
                      )}
                    />
                    {availabilityLabel(data.agent.availabilityStatus)}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                  {t("reportsPage.agentDetailPeriod")}:{" "}
                  <span className="font-medium text-ink-700 dark:text-ink-200">{periodLabel}</span>
                </p>
              </div>
              <button type="button" onClick={onClose} className="btn-ghost h-9 w-9 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex min-h-[40vh] items-center justify-center text-ink-500">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
                </div>
              ) : error ? (
                <p className="py-12 text-center text-sm text-rose-600 dark:text-rose-400">
                  {t("reportsPage.agentDetailLoadError")}
                </p>
              ) : data ? (
                <div className="space-y-8">
                  <Section title={t("reportsPage.agentDetailSectionOverview")}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <MetricCard
                        label={t("reportsPage.agentDetailReceived")}
                        value={String(data.overview.received)}
                        tip={t("reportsPage.agentDetailTipReceived")}
                      />
                      <MetricCard label={t("reportsPage.agentDetailCompleted")} value={String(data.overview.completed)} />
                      <MetricCard label={t("reportsPage.agentDetailInProgress")} value={String(data.overview.inProgress)} />
                      <MetricCard label={t("reportsPage.agentDetailPending")} value={String(data.overview.pending)} />
                      <MetricCard
                        label={t("reportsPage.agentDetailResolutionRate")}
                        value={formatPct(data.overview.resolutionRatePct, na)}
                        tip={t("reportsPage.agentDetailTipResolutionRate")}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailFirstResponse")}
                        value={
                          data.times.sampleFirstResponse > 0
                            ? formatDurationSec(data.times.avgFirstResponseSec, na)
                            : na
                        }
                        tip={t("reportsPage.agentDetailTipFirstResponse")}
                      />
                      {data.meta.slaConfigured ? (
                        <>
                          <MetricCard
                            label={t("reportsPage.agentDetailSlaWithin")}
                            value={formatPct(data.sla.withinPct, na)}
                          />
                          <MetricCard
                            label={t("reportsPage.agentDetailSlaViolated")}
                            value={data.sla.violated != null ? String(data.sla.violated) : na}
                          />
                        </>
                      ) : null}
                      {data.meta.csatEnabled ? (
                        <MetricCard
                          label={t("reportsPage.agentDetailCsat")}
                          value={
                            data.csat.responses > 0
                              ? formatCsat(data.csat.average, na)
                              : t("reportsPage.agentDetailCsatNoRatings")
                          }
                        />
                      ) : null}
                    </div>
                  </Section>

                  <Section title={t("reportsPage.agentDetailSectionTimes")}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetricCard
                        label={t("reportsPage.agentDetailFirstResponse")}
                        value={
                          data.times.sampleFirstResponse > 0
                            ? formatDurationSec(data.times.avgFirstResponseSec, na)
                            : na
                        }
                        tip={t("reportsPage.agentDetailTipFirstResponse")}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailAvgResponse")}
                        value={
                          data.times.sampleResponse > 0
                            ? formatDurationSec(data.times.avgResponseSec, na)
                            : na
                        }
                        tip={t("reportsPage.agentDetailTipAvgResponse")}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailAvgHandle")}
                        value={
                          data.times.sampleHandle > 0 ? formatDurationSec(data.times.avgHandleSec, na) : na
                        }
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailAvgResolution")}
                        value={
                          data.times.sampleResolution > 0
                            ? formatDurationSec(data.times.avgResolutionSec, na)
                            : na
                        }
                      />
                    </div>
                  </Section>

                  <Section title={t("reportsPage.agentDetailSectionQuality")}>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {data.meta.csatEnabled ? (
                        <>
                          <MetricCard
                            label={t("reportsPage.agentDetailCsat")}
                            value={
                              data.csat.responses > 0
                                ? formatCsat(data.csat.average, na)
                                : t("reportsPage.agentDetailCsatNoRatings")
                            }
                          />
                          <MetricCard
                            label={t("reportsPage.agentDetailCsatResponses")}
                            value={data.csat.responses > 0 ? String(data.csat.responses) : na}
                          />
                        </>
                      ) : (
                        <MetricCard label={t("reportsPage.agentDetailCsat")} value={t("reportsPage.agentDetailCsatDisabled")} />
                      )}
                      <MetricCard label={t("reportsPage.agentDetailReopenings")} value={String(data.quality.reopenings)} />
                      <MetricCard
                        label={t("reportsPage.agentDetailReopenRate")}
                        value={formatPct(data.quality.reopenRatePct, na)}
                        tip={t("reportsPage.agentDetailTipReopenRate")}
                      />
                      <MetricCard label={t("reportsPage.agentDetailTransfers")} value={String(data.quality.transfers)} />
                      <MetricCard
                        label={t("reportsPage.agentDetailTransferRate")}
                        value={formatPct(data.quality.transferRatePct, na)}
                        tip={t("reportsPage.agentDetailTipTransferRate")}
                      />
                    </div>
                  </Section>

                  {!data.meta.slaConfigured ? (
                    <Section title={t("reportsPage.agentDetailSectionSla")}>
                      <p className="rounded-xl border border-ink-200 bg-ink-50/80 px-4 py-3 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-300">
                        {t("reportsPage.agentDetailSlaNotConfigured")}
                      </p>
                    </Section>
                  ) : null}

                  <Section title={t("reportsPage.agentDetailSectionProductivity")}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetricCard
                        label={t("reportsPage.agentDetailMessagesSent")}
                        value={String(data.productivity.messagesSent)}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailUniqueClients")}
                        value={String(data.productivity.uniqueClients)}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailOnlineTime")}
                        value={t("reportsPage.agentDetailPresenceUnavailable")}
                      />
                      <MetricCard
                        label={t("reportsPage.agentDetailHandleTime")}
                        value={t("reportsPage.agentDetailPresenceUnavailable")}
                      />
                    </div>
                  </Section>

                  {data.byChannel.length > 0 ? (
                    <Section title={t("reportsPage.agentDetailSectionChannel")}>
                      <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-700">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50">
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColChannel")}</th>
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColReceived")}</th>
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColCompleted")}</th>
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColFirstResponse")}</th>
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColResolution")}</th>
                              <th className="px-4 py-2.5">{t("reportsPage.agentDetailColCsat")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.byChannel.map((row) => (
                              <tr key={row.channelType} className="border-b border-ink-100 dark:border-ink-800/80">
                                <td className="px-4 py-2.5 font-medium text-ink-900 dark:text-ink-100">
                                  {channelLabel(row.channelType)}
                                </td>
                                <td className="px-4 py-2.5 tabular-nums">{row.received}</td>
                                <td className="px-4 py-2.5 tabular-nums">{row.completed}</td>
                                <td className="px-4 py-2.5 tabular-nums">
                                  {formatDurationSec(row.avgFirstResponseSec, na)}
                                </td>
                                <td className="px-4 py-2.5 tabular-nums">{formatPct(row.resolutionRatePct, na)}</td>
                                <td className="px-4 py-2.5 tabular-nums">
                                  {row.csatResponses > 0 && row.csatAverage != null
                                    ? formatCsat(row.csatAverage, na)
                                    : na}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Section>
                  ) : null}

                  {chartData.length > 0 ? (
                    <Section title={t("reportsPage.agentDetailSectionEvolution")}>
                      <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/60">
                        <h4 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">
                          {t("reportsPage.agentDetailChartTitle")}
                        </h4>
                        <MeasuredResponsiveContainer className="h-64 w-full min-w-0" minHeight={256}>
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-ink-200 dark:stroke-ink-700" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar
                              dataKey="received"
                              name={t("reportsPage.agentDetailSeriesReceived")}
                              fill="#6366f1"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="completed"
                              name={t("reportsPage.agentDetailSeriesCompleted")}
                              fill="#10b981"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </MeasuredResponsiveContainer>
                      </div>
                    </Section>
                  ) : null}

                  {data.statusDistribution.some((s) => s.count > 0) ? (
                    <Section title={t("reportsPage.agentDetailSectionStatus")}>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {data.statusDistribution.map((row) => (
                          <div
                            key={row.status}
                            className="flex items-center justify-between rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-700"
                          >
                            <span className="text-sm text-ink-700 dark:text-ink-200">{statusLabel(row.status)}</span>
                            <span className="text-lg font-bold tabular-nums text-ink-900 dark:text-ink-50">{row.count}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  ) : null}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-ink-500">{t("reportsPage.agentDetailNoData")}</p>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
