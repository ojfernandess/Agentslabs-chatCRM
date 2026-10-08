import { useEffect, useMemo, useState } from "react";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import { Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";

type Provider = "wavoip" | "nvoip" | "threecx" | "sip";
type Direction = "INCOMING" | "OUTGOING" | "UNKNOWN";
type Outcome = "answered" | "missed" | "in_progress" | "other";

type Payload = {
  agent: { userId: string; name: string };
  summary: {
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    answeredCalls: number;
    missedCalls: number;
    totalTalkTimeSec: number;
    avgTalkTimeSec: number | null;
  };
  calls: Array<{
    id: string;
    provider: Provider;
    direction: Direction;
    status: string;
    outcome: Outcome;
    caller: string;
    receiver: string;
    contactName: string | null;
    durationSec: number | null;
    startedAt: string;
  }>;
};

type Props = {
  open: boolean;
  userId: string | null;
  agentName: string;
  fromStr: string;
  toStr: string;
  onClose: () => void;
};

function formatTalk(totalSec: number | null): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return "";
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function TelephonyAgentDetailDrawer({ open, userId, agentName, fromStr, toStr, onClose }: Props) {
  const { t, dateLocale } = useI18n();
  const na = t("reportsPage.na");
  const [data, setData] = useState<Payload | null>(null);
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
        const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
        const res = await api.get<Payload>(`/reports/telephony/agents/${userId}?${params.toString()}`);
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
  }, [open, userId, fromStr, toStr]);

  const periodLabel = useMemo(() => {
    try {
      const from = format(parseISO(fromStr), "dd/MM/yyyy", { locale: dateLocale });
      const to = format(parseISO(toStr), "dd/MM/yyyy", { locale: dateLocale });
      return `${from} – ${to}`;
    } catch {
      return `${fromStr} – ${toStr}`;
    }
  }, [fromStr, toStr, dateLocale]);

  const providerLabel = (provider: Provider) => {
    if (provider === "wavoip") return t("reportsPage.providerWavoip");
    if (provider === "nvoip") return t("reportsPage.providerNvoip");
    if (provider === "sip") return t("reportsPage.providerSip");
    return t("reportsPage.providerThreecx");
  };

  const outcomeLabel = (outcome: Outcome) => {
    if (outcome === "answered") return t("reportsPage.telephonyAgentOutcomeAnswered");
    if (outcome === "missed") return t("reportsPage.telephonyAgentOutcomeMissed");
    if (outcome === "in_progress") return t("reportsPage.telephonyAgentOutcomeProgress");
    return t("reportsPage.telephonyAgentOutcomeOther");
  };

  const directionLabel = (direction: Direction) => {
    if (direction === "OUTGOING") return t("reportsPage.colOutbound");
    if (direction === "INCOMING") return t("reportsPage.colInbound");
    return na;
  };

  const displayName = data?.agent.name ?? agentName;
  const summary = data?.summary;

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
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-ink-900 dark:text-ink-50">{displayName}</h2>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("reportsPage.telephonyAgentDetailTitle")}</p>
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
                  {t("reportsPage.telephonyAgentDetailLoadError")}
                </p>
              ) : summary ? (
                <div className="space-y-8">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Metric label={t("reportsPage.colCalls")} value={String(summary.totalCalls)} />
                    <Metric label={t("reportsPage.colAnswered")} value={String(summary.answeredCalls)} />
                    <Metric label={t("reportsPage.colMissed")} value={String(summary.missedCalls)} />
                    <Metric label={t("reportsPage.colInbound")} value={String(summary.inboundCalls)} />
                    <Metric label={t("reportsPage.colOutbound")} value={String(summary.outboundCalls)} />
                    <Metric
                      label={t("reportsPage.colTalkTime")}
                      value={summary.totalTalkTimeSec > 0 ? formatTalk(summary.totalTalkTimeSec) : na}
                    />
                    <Metric
                      label={t("reportsPage.telephonyKpiAvgTalk")}
                      value={summary.avgTalkTimeSec != null ? formatTalk(summary.avgTalkTimeSec) : na}
                    />
                  </div>

                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                      {t("reportsPage.telephonyAgentHistory")}
                    </h3>
                    {data.calls.length === 0 ? (
                      <p className="text-sm text-ink-500">{t("reportsPage.telephonyAgentHistoryEmpty")}</p>
                    ) : (
                      <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
                        {data.calls.map((call) => {
                          const peer = call.direction === "OUTGOING" ? call.receiver : call.caller;
                          const title = call.contactName || peer || na;
                          return (
                            <li key={`${call.provider}-${call.id}`} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{title}</p>
                                  <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">
                                    {peer && peer !== title ? `${peer} · ` : ""}
                                    {directionLabel(call.direction)}
                                    {" · "}
                                    {providerLabel(call.provider)}
                                    {" · "}
                                    {format(parseISO(call.startedAt), "dd/MM/yyyy HH:mm", { locale: dateLocale })}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{outcomeLabel(call.outcome)}</p>
                                  <p className="mt-0.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                                    {call.durationSec != null && call.durationSec > 0 ? formatTalk(call.durationSec) : na}
                                  </p>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/60">
      <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{value}</p>
    </div>
  );
}
