import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { Locale } from "date-fns";
import { endOfDay, format, parseISO, startOfDay, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Bot,
  Clock,
  Download,
  Inbox,
  MessageSquare,
  RefreshCw,
  Timer,
  TrendingUp,
  UsersRound,
  Tag,
  PieChart,
  Phone,
  PhoneCall,
} from "lucide-react";
import clsx from "clsx";
import { PageTransition } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { formatCurrencyUnits } from "@/lib/currency";

type Granularity = "day" | "week" | "month";

interface ReportsPayload {
  meta: {
    from: string;
    to: string;
    granularity: Granularity;
    sla?: {
      teamsWithBusinessHours: number;
      firstResponsePairs: number;
      firstResponsePairsInBusinessHours: number;
    };
    agentBot?: {
      enabled: boolean;
      botId: string | null;
      name: string | null;
    };
  };
  summary: {
    openConversations: number;
    pendingConversations: number;
    conversationsCreated: number;
    conversationsResolved: number;
    messagesInbound: number;
    messagesOutbound: number;
    avgFirstResponseMinutes: number | null;
    avgFirstResponseBusinessMinutes: number | null;
    avgResolutionMinutes: number | null;
    closuresWithValue: number;
    closureValueSum: number;
    csatResponses: number;
    csatAverage: number | null;
    csatResponseRatePct: number | null;
    messagesOutboundBot?: number;
    messagesOutboundHuman?: number;
    conversationsWithBotReplies?: number;
    handoffEvents?: number;
    handoffsToHuman?: number;
    pendingBotQueue?: number;
  };
  csatByScore: Array<{ score: number; count: number }>;
  timeSeries: Array<{
    bucket: string;
    conversationsCreated: number;
    conversationsResolved: number;
    messagesInbound: number;
    messagesOutbound: number;
    messagesOutboundBot?: number;
    messagesOutboundHuman?: number;
  }>;
  agents: Array<{
    userId: string;
    name: string;
    conversationsTouched: number;
    outboundMessages: number;
  }>;
  teams: Array<{ teamId: string; name: string; conversationsCreated: number }>;
  leadTypes: Array<{
    leadTypeId: string;
    name: string;
    color: string;
    resolvedCount: number;
    closureValueSum: number;
  }>;
  heatmap: { cells: number[][]; max: number };
  tags: Array<{ tagId: string; name: string; color: string; conversationsCount: number }>;
  telephony?: TelephonyReports;
}

type TelephonyProvider = "wavoip" | "nvoip" | "threecx";

interface TelephonyReports {
  enabled: boolean;
  providers: Record<TelephonyProvider, { enabled: boolean; hasData: boolean }>;
  summary: {
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    inProgressCalls: number;
    inboundAnswered: number;
    inboundMissed: number;
    answerRatePct: number | null;
    abandonRatePct: number | null;
    avgTalkTimeSec: number | null;
    totalTalkTimeSec: number;
    recordingsCount: number;
  };
  timeSeries: Array<{
    bucket: string;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
  }>;
  byProvider: Array<{
    provider: TelephonyProvider;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    avgTalkTimeSec: number | null;
  }>;
  agents: Array<{
    userId: string;
    name: string;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    totalTalkTimeSec: number;
    avgTalkTimeSec: number | null;
  }>;
  statusBreakdown: Array<{ status: string; count: number }>;
}

type TabId = "overview" | "conversations" | "agents" | "teams" | "revenue" | "telephony";

function toInputDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function downloadCsv(filename: string, rows: string[][]) {
  const bom = "\uFEFF";
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { t, dateLocale } = useI18n();
  const [tab, setTab] = useState<TabId>("overview");
  const [fromStr, setFromStr] = useState(() => toInputDate(startOfDay(subDays(new Date(), 29))));
  const [toStr, setToStr] = useState(() => toInputDate(new Date()));
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from = startOfDay(parseISO(fromStr));
      const to = endOfDay(parseISO(toStr));
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
      });
      const res = await api.get<ReportsPayload>(`/reports?${params.toString()}`);
      setData(res);
    } catch (e) {
      console.error(e);
      setError("load_failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromStr, toStr, granularity]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartDataCsat = useMemo(
    () =>
      (data?.csatByScore ?? []).map((r) => ({
        label: String(r.score),
        count: r.count,
      })),
    [data],
  );

  const applyPreset = (inclusiveDays: number) => {
    const end = new Date();
    setToStr(toInputDate(end));
    setFromStr(toInputDate(startOfDay(subDays(end, inclusiveDays - 1))));
  };

  const chartData = useMemo(() => {
    if (!data?.timeSeries.length) return [];
    return data.timeSeries.map((row) => ({
      ...row,
      messagesOutboundBot: row.messagesOutboundBot ?? 0,
      messagesOutboundHuman: row.messagesOutboundHuman ?? 0,
      label: formatBucketLabel(row.bucket, data.meta.granularity, dateLocale),
    }));
  }, [data, dateLocale]);

  const chartTelephonyData = useMemo(() => {
    if (!data?.telephony?.timeSeries.length) return [];
    return data.telephony.timeSeries.map((row) => ({
      ...row,
      label: formatBucketLabel(row.bucket, data.meta.granularity, dateLocale),
    }));
  }, [data, dateLocale]);

  const dowLabels = useMemo(
    () => [
      t("reportsPage.dowOff"),
      t("reportsPage.dowMon"),
      t("reportsPage.dowTue"),
      t("reportsPage.dowWed"),
      t("reportsPage.dowThu"),
      t("reportsPage.dowFri"),
      t("reportsPage.dowSat"),
    ],
    [t],
  );

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      [
        "bucket",
        "conversations_created",
        "conversations_resolved",
        "messages_inbound",
        "messages_outbound",
        "messages_outbound_bot",
        "messages_outbound_human",
      ],
      ...data.timeSeries.map((r) => [
        r.bucket,
        String(r.conversationsCreated),
        String(r.conversationsResolved),
        String(r.messagesInbound),
        String(r.messagesOutbound),
        String(r.messagesOutboundBot ?? 0),
        String(r.messagesOutboundHuman ?? 0),
      ]),
      [],
      [
        "avg_first_response_minutes",
        data.summary.avgFirstResponseMinutes != null ? String(data.summary.avgFirstResponseMinutes) : "",
      ],
      [
        "avg_first_response_business_minutes",
        data.summary.avgFirstResponseBusinessMinutes != null ? String(data.summary.avgFirstResponseBusinessMinutes) : "",
      ],
      [],
      ["agent", "conversations", "outbound_messages"],
      ...data.agents.map((a) => [a.name, String(a.conversationsTouched), String(a.outboundMessages)]),
    ];
    if (data.telephony?.enabled) {
      const tel = data.telephony;
      rows.push(
        [],
        ["telephony_total_calls", String(tel.summary.totalCalls)],
        ["telephony_inbound", String(tel.summary.inboundCalls)],
        ["telephony_outbound", String(tel.summary.outboundCalls)],
        ["telephony_answered", String(tel.summary.answeredCalls)],
        ["telephony_missed", String(tel.summary.missedCalls)],
        [
          "telephony_answer_rate_pct",
          tel.summary.answerRatePct != null ? String(tel.summary.answerRatePct) : "",
        ],
        [
          "telephony_avg_talk_sec",
          tel.summary.avgTalkTimeSec != null ? String(tel.summary.avgTalkTimeSec) : "",
        ],
        [],
        [
          "bucket",
          "total_calls",
          "inbound",
          "outbound",
          "answered",
          "missed",
        ],
        ...tel.timeSeries.map((r) => [
          r.bucket,
          String(r.totalCalls),
          String(r.inboundCalls),
          String(r.outboundCalls),
          String(r.answeredCalls),
          String(r.missedCalls),
        ]),
        [],
        ["agent", "calls", "answered", "missed", "talk_time_sec"],
        ...tel.agents.map((a) => [
          a.name,
          String(a.totalCalls),
          String(a.answeredCalls),
          String(a.missedCalls),
          String(a.totalTalkTimeSec),
        ]),
      );
    }
    downloadCsv(`openconduit-reports-${fromStr}-${toStr}.csv`, rows);
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: t("reportsPage.tabOverview") },
    { id: "conversations", label: t("reportsPage.tabConversations") },
    { id: "agents", label: t("reportsPage.tabAgents") },
    { id: "teams", label: t("reportsPage.tabTeams") },
    { id: "revenue", label: t("reportsPage.tabRevenue") },
    ...(data?.telephony?.enabled
      ? [{ id: "telephony" as const, label: t("reportsPage.tabTelephony") }]
      : []),
  ];

  const fmtMin = (v: number | null) =>
    v != null && Number.isFinite(v) ? `${Math.round(v * 10) / 10} ${t("reportsPage.minutesAbbr")}` : t("reportsPage.na");

  const fmtSec = (v: number | null) =>
    v != null && Number.isFinite(v) ? formatTalkDuration(v) : t("reportsPage.na");

  const fmtPct = (v: number | null) =>
    v != null && Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : t("reportsPage.na");

  const providerLabel = (p: TelephonyProvider) => {
    if (p === "wavoip") return t("reportsPage.providerWavoip");
    if (p === "nvoip") return t("reportsPage.providerNvoip");
    return t("reportsPage.providerThreecx");
  };

  const callStatusLabel = (status: string) => {
    const key = `reportsPage.callStatus_${status}` as "reportsPage.callStatus_ENDED";
    const translated = t(key);
    return translated !== key ? translated : status;
  };

  return (
    <PageTransition>
      <div className="flex min-h-full flex-col gap-6 p-6 sm:p-8">
        <header className="flex flex-col gap-4 border-b border-ink-200 pb-6 dark:border-ink-800 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400">
              <PieChart className="h-6 w-6" />
              <span className="text-xs font-semibold uppercase tracking-wide">{t("reportsPage.badgeCaption")}</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">{t("reportsPage.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-ink-600 dark:text-ink-400">{t("reportsPage.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1.5 border-b border-ink-100 pb-3 dark:border-ink-800 lg:border-0 lg:pb-0">
              <button
                type="button"
                onClick={() => applyPreset(7)}
                className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                {t("reportsPage.presetLast7")}
              </button>
              <button
                type="button"
                onClick={() => applyPreset(30)}
                className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                {t("reportsPage.presetLast30")}
              </button>
              <button
                type="button"
                onClick={() => applyPreset(90)}
                className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                {t("reportsPage.presetLast90")}
              </button>
            </div>
            <label className="flex flex-col text-xs font-medium text-ink-600 dark:text-ink-400">
              {t("reportsPage.from")}
              <input
                type="date"
                value={fromStr}
                onChange={(e) => setFromStr(e.target.value)}
                className="mt-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-ink-600 dark:text-ink-400">
              {t("reportsPage.to")}
              <input
                type="date"
                value={toStr}
                onChange={(e) => setToStr(e.target.value)}
                className="mt-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-ink-600 dark:text-ink-400">
              {t("reportsPage.granularity")}
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
                className="mt-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              >
                <option value="day">{t("reportsPage.granularityDay")}</option>
                <option value="week">{t("reportsPage.granularityWeek")}</option>
                <option value="month">{t("reportsPage.granularityMonth")}</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
            >
              <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
              {t("reportsPage.refresh")}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {t("reportsPage.exportCsv")}
            </button>
          </div>
        </header>

        {error && !data ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {t("reportsPage.loadError")}
          </div>
        ) : null}

        {!data && loading ? (
          <div className="flex flex-1 items-center justify-center py-24">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : data ? (
          <>
            <nav className="flex gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-ink-50/80 p-1 dark:border-ink-800 dark:bg-ink-900/40">
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setTab(x.id)}
                  className={clsx(
                    "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    tab === x.id
                      ? "bg-white text-brand-700 shadow-sm dark:bg-ink-800 dark:text-brand-300"
                      : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
                  )}
                >
                  {x.label}
                </button>
              ))}
            </nav>

            {tab === "overview" && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Kpi icon={Inbox} label={t("reportsPage.kpiOpen")} value={data.summary.openConversations} />
                  <Kpi icon={Clock} label={t("reportsPage.kpiPending")} value={data.summary.pendingConversations} />
                  <Kpi icon={TrendingUp} label={t("reportsPage.kpiCreated")} value={data.summary.conversationsCreated} />
                  <Kpi icon={MessageSquare} label={t("reportsPage.kpiResolved")} value={data.summary.conversationsResolved} />
                  <Kpi icon={BarChart3} label={t("reportsPage.kpiInbound")} value={data.summary.messagesInbound} />
                  <Kpi icon={MessageSquare} label={t("reportsPage.kpiOutbound")} value={data.summary.messagesOutbound} />
                  <Kpi icon={Clock} label={t("reportsPage.kpiAvgFirstResponse")} value={fmtMin(data.summary.avgFirstResponseMinutes)} />
                  <Kpi
                    icon={Timer}
                    label={t("reportsPage.kpiAvgFirstResponseBusiness")}
                    value={fmtMin(data.summary.avgFirstResponseBusinessMinutes)}
                  />
                  <Kpi icon={Clock} label={t("reportsPage.kpiAvgResolution")} value={fmtMin(data.summary.avgResolutionMinutes)} />
                  <Kpi
                    icon={PieChart}
                    label={t("reportsPage.kpiClosureSum")}
                    value={formatCurrencyUnits(data.summary.closureValueSum)}
                  />
                  <Kpi icon={Tag} label={t("reportsPage.kpiClosuresWithValue")} value={data.summary.closuresWithValue} />
                </div>

                {data.meta.agentBot?.enabled ? (
                  <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900 dark:text-ink-50">
                          <Bot className="h-5 w-5 text-violet-500" />
                          {t("reportsPage.botSectionTitle")}
                        </h2>
                        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                          {t("reportsPage.botSectionSubtitle")}
                          {data.meta.agentBot.name?.trim() ? (
                            <span className="font-medium text-ink-800 dark:text-ink-200">
                              {" "}
                              — {data.meta.agentBot.name.trim()}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <Kpi
                        icon={Bot}
                        label={t("reportsPage.kpiBotOutbound")}
                        value={data.summary.messagesOutboundBot ?? 0}
                      />
                      <Kpi
                        icon={UsersRound}
                        label={t("reportsPage.kpiHumanOutbound")}
                        value={data.summary.messagesOutboundHuman ?? 0}
                      />
                      <Kpi
                        icon={MessageSquare}
                        label={t("reportsPage.kpiConversationsBot")}
                        value={data.summary.conversationsWithBotReplies ?? 0}
                      />
                      <Kpi
                        icon={TrendingUp}
                        label={t("reportsPage.kpiHandoffEvents")}
                        value={data.summary.handoffEvents ?? 0}
                      />
                      <Kpi
                        icon={UsersRound}
                        label={t("reportsPage.kpiHandoffsToHuman")}
                        value={data.summary.handoffsToHuman ?? 0}
                      />
                      <Kpi icon={Inbox} label={t("reportsPage.kpiPendingBotQueue")} value={data.summary.pendingBotQueue ?? 0} />
                    </div>
                    <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">{t("reportsPage.botFootnote")}</p>
                    <div className="mt-6 h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="messagesOutboundHuman"
                            name={t("reportsPage.seriesOutboundHuman")}
                            stackId="out"
                            fill="#0ea5e9"
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar
                            dataKey="messagesOutboundBot"
                            name={t("reportsPage.seriesOutboundBot")}
                            stackId="out"
                            fill="#8b5cf6"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-center text-xs text-ink-500 dark:text-ink-400">{t("reportsPage.chartBotVsHumanTitle")}</p>
                  </section>
                ) : null}

                <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("reportsPage.csatSectionTitle")}</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("reportsPage.csatFootnote")}</p>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Kpi
                      icon={PieChart}
                      label={t("reportsPage.csatAvg")}
                      value={
                        data.summary.csatAverage != null ? String(Math.round(data.summary.csatAverage * 10) / 10) : t("reportsPage.na")
                      }
                    />
                    <Kpi icon={MessageSquare} label={t("reportsPage.csatResponses")} value={data.summary.csatResponses} />
                    <Kpi
                      icon={TrendingUp}
                      label={t("reportsPage.csatRate")}
                      value={
                        data.summary.csatResponseRatePct != null
                          ? `${Math.round(data.summary.csatResponseRatePct * 10) / 10}%`
                          : t("reportsPage.na")
                      }
                    />
                  </div>
                  <div className="mt-6 h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartDataCsat}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip />
                        <Bar dataKey="count" name={t("reportsPage.csatDistribution")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("reportsPage.heatmapTitle")}</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("reportsPage.heatmapSubtitle")}</p>
                  <Heatmap cells={data.heatmap.cells} max={data.heatmap.max} dowLabels={dowLabels} hourLabel={t("reportsPage.hour")} />
                </section>

                <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("reportsPage.tagsTitle")}</h2>
                  {data.tags.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-500">{t("reportsPage.emptyTags")}</p>
                  ) : (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {data.tags.map((x) => (
                        <li
                          key={x.tagId}
                          className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-800/80"
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: x.color }} />
                          <span className="font-medium text-ink-900 dark:text-ink-100">{x.name}</span>
                          <span className="text-ink-500 dark:text-ink-400">({x.conversationsCount})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <Footnotes t={t} />
              </div>
            )}

            {tab === "conversations" && (
              <div className="space-y-8">
                <ChartCard title={t("reportsPage.chartConversationsTitle")}>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="conversationsCreated" name={t("reportsPage.seriesCreated")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="conversationsResolved" name={t("reportsPage.seriesResolved")} fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("reportsPage.chartMessagesTitle")}>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="messagesInbound" name={t("reportsPage.seriesInbound")} fill="#6366f1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="messagesOutbound" name={t("reportsPage.seriesOutbound")} fill="#6734ff" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                {data.meta.agentBot?.enabled ? (
                  <ChartCard title={t("reportsPage.chartBotVsHumanTitle")}>
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="messagesOutboundHuman"
                            name={t("reportsPage.seriesOutboundHuman")}
                            stackId="botHum"
                            fill="#0ea5e9"
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar
                            dataKey="messagesOutboundBot"
                            name={t("reportsPage.seriesOutboundBot")}
                            stackId="botHum"
                            fill="#8b5cf6"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("reportsPage.botFootnote")}</p>
                  </ChartCard>
                ) : null}
                <Footnotes t={t} />
              </div>
            )}

            {tab === "agents" && (
              <section className="rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900 dark:text-ink-50">
                    <UsersRound className="h-5 w-5 text-brand-500" />
                    {t("reportsPage.agentsTitle")}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  {data.agents.every((a) => a.outboundMessages === 0) ? (
                    <p className="px-6 py-8 text-sm text-ink-500">{t("reportsPage.emptyAgents")}</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
                          <th className="px-6 py-3">{t("reportsPage.colAgent")}</th>
                          <th className="px-6 py-3">{t("reportsPage.colConversations")}</th>
                          <th className="px-6 py-3">{t("reportsPage.colMessages")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.agents.map((a) => (
                          <tr
                            key={a.userId}
                            className="border-b border-ink-100 dark:border-ink-800/80 hover:bg-ink-50/50 dark:hover:bg-ink-800/40"
                          >
                            <td className="px-6 py-3 font-medium text-ink-900 dark:text-ink-100">{a.name}</td>
                            <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.conversationsTouched}</td>
                            <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.outboundMessages}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            )}

            {tab === "teams" && (
              <section className="rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("reportsPage.teamsTitle")}</h2>
                </div>
                <div className="overflow-x-auto">
                  {data.teams.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-ink-500">{t("reportsPage.emptyTeams")}</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
                          <th className="px-6 py-3">{t("reportsPage.colTeam")}</th>
                          <th className="px-6 py-3">{t("reportsPage.colConvCreated")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.teams.map((x) => (
                          <tr
                            key={x.teamId}
                            className="border-b border-ink-100 dark:border-ink-800/80 hover:bg-ink-50/50 dark:hover:bg-ink-800/40"
                          >
                            <td className="px-6 py-3 font-medium text-ink-900 dark:text-ink-100">{x.name}</td>
                            <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{x.conversationsCreated}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            )}

            {tab === "telephony" && data.telephony?.enabled ? (
              <div className="space-y-8">
                <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900 dark:text-ink-50">
                      <Phone className="h-5 w-5 text-red-500" />
                      {t("reportsPage.telephonySectionTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                      {t("reportsPage.telephonySectionSubtitle")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(
                        [
                          ["wavoip", data.telephony.providers.wavoip],
                          ["nvoip", data.telephony.providers.nvoip],
                          ["threecx", data.telephony.providers.threecx],
                        ] as const
                      )
                        .filter(([, p]) => p.enabled)
                        .map(([key, p]) => (
                          <span
                            key={key}
                            className={clsx(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              p.hasData
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                                : "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400",
                            )}
                          >
                            {providerLabel(key)}
                            {p.hasData ? "" : " · —"}
                          </span>
                        ))}
                    </div>
                  </div>

                  {data.telephony.summary.totalCalls === 0 ? (
                    <p className="mt-6 text-sm text-ink-500">{t("reportsPage.emptyTelephony")}</p>
                  ) : (
                    <>
                      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Kpi icon={PhoneCall} label={t("reportsPage.telephonyKpiTotal")} value={data.telephony.summary.totalCalls} />
                        <Kpi icon={Phone} label={t("reportsPage.telephonyKpiInbound")} value={data.telephony.summary.inboundCalls} />
                        <Kpi icon={Phone} label={t("reportsPage.telephonyKpiOutbound")} value={data.telephony.summary.outboundCalls} />
                        <Kpi icon={PhoneCall} label={t("reportsPage.telephonyKpiAnswered")} value={data.telephony.summary.answeredCalls} />
                        <Kpi icon={Clock} label={t("reportsPage.telephonyKpiMissed")} value={data.telephony.summary.missedCalls} />
                        <Kpi icon={Timer} label={t("reportsPage.telephonyKpiInProgress")} value={data.telephony.summary.inProgressCalls} />
                        <Kpi icon={TrendingUp} label={t("reportsPage.telephonyKpiAnswerRate")} value={fmtPct(data.telephony.summary.answerRatePct)} />
                        <Kpi icon={BarChart3} label={t("reportsPage.telephonyKpiAbandonRate")} value={fmtPct(data.telephony.summary.abandonRatePct)} />
                        <Kpi icon={Clock} label={t("reportsPage.telephonyKpiAvgTalk")} value={fmtSec(data.telephony.summary.avgTalkTimeSec)} />
                        <Kpi icon={Timer} label={t("reportsPage.telephonyKpiTotalTalk")} value={fmtSec(data.telephony.summary.totalTalkTimeSec)} />
                        <Kpi icon={MessageSquare} label={t("reportsPage.telephonyKpiRecordings")} value={data.telephony.summary.recordingsCount} />
                      </div>

                      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
                        <ChartCard title={t("reportsPage.chartTelephonyVolumeTitle")}>
                          <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartTelephonyData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="inboundCalls" name={t("reportsPage.seriesTelephonyInbound")} fill="#6366f1" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="outboundCalls" name={t("reportsPage.seriesTelephonyOutbound")} fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </ChartCard>
                        <ChartCard title={t("reportsPage.chartTelephonyOutcomeTitle")}>
                          <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartTelephonyData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="answeredCalls" name={t("reportsPage.seriesTelephonyAnswered")} fill="#10b981" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="missedCalls" name={t("reportsPage.seriesTelephonyMissed")} fill="#ef4444" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </ChartCard>
                      </div>
                    </>
                  )}
                </section>

                {data.telephony.summary.totalCalls > 0 && data.telephony.byProvider.length > 0 ? (
                  <section className="rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                    <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                      <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                        {t("reportsPage.telephonyProvidersTitle")}
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
                            <th className="px-6 py-3">{t("reportsPage.colProvider")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colCalls")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colInbound")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colOutbound")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colAnswered")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colMissed")}</th>
                            <th className="px-6 py-3">{t("reportsPage.colTalkTime")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.telephony.byProvider.map((row) => (
                            <tr
                              key={row.provider}
                              className="border-b border-ink-100 dark:border-ink-800/80 hover:bg-ink-50/50 dark:hover:bg-ink-800/40"
                            >
                              <td className="px-6 py-3 font-medium text-ink-900 dark:text-ink-100">
                                {providerLabel(row.provider)}
                              </td>
                              <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{row.totalCalls}</td>
                              <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{row.inboundCalls}</td>
                              <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{row.outboundCalls}</td>
                              <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{row.answeredCalls}</td>
                              <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{row.missedCalls}</td>
                              <td className="px-6 py-3 font-mono text-ink-700 dark:text-ink-300">
                                {fmtSec(row.avgTalkTimeSec)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {data.telephony.summary.totalCalls > 0 ? (
                  <section className="rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                    <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900 dark:text-ink-50">
                        <UsersRound className="h-5 w-5 text-brand-500" />
                        {t("reportsPage.telephonyAgentsTitle")}
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      {data.telephony.agents.length === 0 ? (
                        <p className="px-6 py-8 text-sm text-ink-500">{t("reportsPage.emptyTelephonyAgents")}</p>
                      ) : (
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
                              <th className="px-6 py-3">{t("reportsPage.colAgent")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colCalls")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colInbound")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colOutbound")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colAnswered")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colMissed")}</th>
                              <th className="px-6 py-3">{t("reportsPage.colTalkTime")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.telephony.agents.map((a) => (
                              <tr
                                key={a.userId}
                                className="border-b border-ink-100 dark:border-ink-800/80 hover:bg-ink-50/50 dark:hover:bg-ink-800/40"
                              >
                                <td className="px-6 py-3 font-medium text-ink-900 dark:text-ink-100">{a.name}</td>
                                <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.totalCalls}</td>
                                <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.inboundCalls}</td>
                                <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.outboundCalls}</td>
                                <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.answeredCalls}</td>
                                <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{a.missedCalls}</td>
                                <td className="px-6 py-3 font-mono text-ink-700 dark:text-ink-300">
                                  {fmtSec(a.avgTalkTimeSec)} ({formatTalkDuration(a.totalTalkTimeSec)})
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                ) : null}

                {data.telephony.summary.totalCalls > 0 && data.telephony.statusBreakdown.length > 0 ? (
                  <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                    <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                      {t("reportsPage.telephonyStatusTitle")}
                    </h2>
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {data.telephony.statusBreakdown.map((s) => (
                        <li
                          key={s.status}
                          className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-800/80"
                        >
                          <span className="font-mono text-xs font-semibold text-ink-700 dark:text-ink-200">
                            {callStatusLabel(s.status)}
                          </span>
                          <span className="text-ink-500 dark:text-ink-400">({s.count})</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <footer className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3 text-xs leading-relaxed text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
                  <p>{t("reportsPage.telephonyFootnote")}</p>
                </footer>
              </div>
            ) : null}

            {tab === "revenue" && (
              <section className="rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
                <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("reportsPage.leadTypesTitle")}</h2>
                </div>
                <div className="overflow-x-auto">
                  {data.leadTypes.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-ink-500">{t("reportsPage.emptyLeadTypes")}</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-100 bg-ink-50/80 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
                          <th className="px-6 py-3">{t("reportsPage.colLeadType")}</th>
                          <th className="px-6 py-3">{t("reportsPage.colResolved")}</th>
                          <th className="px-6 py-3">{t("reportsPage.colValue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.leadTypes.map((x) => (
                          <tr
                            key={x.leadTypeId}
                            className="border-b border-ink-100 dark:border-ink-800/80 hover:bg-ink-50/50 dark:hover:bg-ink-800/40"
                          >
                            <td className="px-6 py-3">
                              <span className="inline-flex items-center gap-2 font-medium text-ink-900 dark:text-ink-100">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: x.color }} />
                                {x.name}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-ink-700 dark:text-ink-300">{x.resolvedCount}</td>
                            <td className="px-6 py-3 text-ink-700 dark:text-ink-300">
                              {formatCurrencyUnits(x.closureValueSum)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </PageTransition>
  );
}

function formatTalkDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBucketLabel(bucketIso: string, g: Granularity, locale: Locale): string {
  const d = parseISO(bucketIso);
  if (g === "month") return format(d, "MMM yyyy", { locale });
  if (g === "week") return format(d, "'S' w, MMM yyyy", { locale });
  return format(d, "d MMM", { locale });
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
        <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{value}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900/60">
      <h2 className="mb-4 text-lg font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
      {children}
    </section>
  );
}

function Heatmap({
  cells,
  max,
  dowLabels,
  hourLabel,
}: {
  cells: number[][];
  max: number;
  dowLabels: string[];
  hourLabel: string;
}) {
  const intensity = (n: number) => {
    if (max <= 0) return "rgba(59,130,246,0.08)";
    const t = Math.min(1, n / max);
    return `rgba(59,130,246,${0.08 + t * 0.85})`;
  };

  return (
    <div className="mt-6 overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-10 shrink-0 pt-6 text-[10px] font-medium text-ink-400" aria-hidden />
          <div className="flex flex-1">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="w-7 shrink-0 text-center text-[10px] text-ink-400">
                {h % 6 === 0 ? h : ""}
              </div>
            ))}
          </div>
        </div>
        {cells.map((row, di) => (
          <div key={di} className="flex items-center">
            <div className="w-10 shrink-0 py-0.5 pr-2 text-right text-[10px] font-medium text-ink-600 dark:text-ink-400">
              {dowLabels[di]}
            </div>
            <div className="flex flex-1">
              {row.map((n, hi) => (
                <div
                  key={hi}
                  title={`${dowLabels[di]} ${hourLabel} ${hi}:00 — ${n}`}
                  className="m-[1px] h-5 w-7 shrink-0 rounded-sm"
                  style={{ backgroundColor: intensity(n) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footnotes({ t }: { t: (path: string) => string }) {
  return (
    <footer className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3 text-xs leading-relaxed text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
      <p>{t("reportsPage.footnoteFirstResponse")}</p>
      <p className="mt-2">{t("reportsPage.footnoteFirstResponseBusiness")}</p>
      <p className="mt-2">{t("reportsPage.footnoteResolution")}</p>
    </footer>
  );
}
