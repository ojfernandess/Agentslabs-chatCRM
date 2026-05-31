import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ClipboardCheck, Clock, PhoneCall } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCurrencyUnits } from "@/lib/currency";
import {
  computeClosureRollupTotals,
  isPipelineClosureActiveForRollup,
  shouldDisplayClosureValueBadge,
} from "@/lib/closureValueRollup";

interface Row {
  id: string;
  conversationId: string;
  sessionIndex: number;
  status: string;
  resolvedAt: string;
  reopenedAt: string | null;
  isNewAttendance: boolean;
  closureValue: number | null;
  closureReason: string | null;
  contact: { id: string; name: string; phone: string };
  team: { id: string; name: string } | null;
  leadType: { id: string; name: string; color: string; valueRollup?: string } | null;
  messages: { body: string | null; createdAt: string }[];
}

interface WavoipCallRow {
  id: string;
  direction: string;
  status: string;
  durationSec: number | null;
  createdAt: string;
  endedAt: string | null;
  contact: { id: string; name: string; phone: string } | null;
  conversationId: string | null;
}

export function MyAttendancePage() {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [callRows, setCallRows] = useState<WavoipCallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ wonValue: 0, pipelineValue: 0 });
  const [loading, setLoading] = useState(true);
  const hasAnimated = useRef(false);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  const callStatusLabel = (status: string) => {
    const key = `wavoip.voice.callStatus.${status.toUpperCase()}`;
    const label = t(key);
    return label !== key ? label : status;
  };

  useEffect(() => {
    async function load() {
      if (!hasAnimated.current) setLoading(true);
      try {
        const [attendanceRes, callsRes] = await Promise.all([
          api.get<{
            data: Row[];
            total: number;
            summary?: { wonValue: number; pipelineValue: number };
          }>("/conversations/my-attendance?pageSize=100"),
          api.get<{ data: WavoipCallRow[] }>("/wavoip/calls/my-recent").catch(() => ({ data: [] as WavoipCallRow[] })),
        ]);
        setRows(attendanceRes.data);
        setTotal(attendanceRes.total);
        setCallRows(callsRes.data ?? []);
        if (attendanceRes.summary) {
          setSummary(attendanceRes.summary);
        } else {
          setSummary(computeClosureRollupTotals(attendanceRes.data));
        }
      } catch {
        setRows([]);
        setTotal(0);
        setCallRows([]);
        setSummary({ wonValue: 0, pipelineValue: 0 });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const totalWonValue = summary.wonValue;
  const totalPipelineValue = summary.pipelineValue;

  const rollupRows = rows.map((r) => ({
    conversationId: r.conversationId,
    sessionIndex: r.sessionIndex,
    closureValue: r.closureValue,
    leadType: r.leadType,
  }));

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-ink-50">{t("attendance.title")}</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-ink-400">{t("attendance.subtitle")}</p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-ink-700 dark:bg-ink-900/50">
            <p className="text-gray-500 dark:text-ink-400">{t("attendance.totalValue")}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-ink-50">{fmtMoney(totalWonValue)}</p>
            <p className="mt-1 text-[10px] leading-snug text-gray-400 dark:text-ink-500">{t("attendance.totalValueHint")}</p>
            <p className="mt-2 text-xs font-medium text-gray-600 dark:text-ink-300">{t("attendance.negotiationSubtotal")}</p>
            <p className="text-base font-semibold text-gray-800 dark:text-ink-100">{fmtMoney(totalPipelineValue)}</p>
            <p className="mt-1 text-[10px] leading-snug text-gray-400 dark:text-ink-500">{t("attendance.negotiationSubtotalHint")}</p>
            <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400 dark:border-ink-800 dark:text-ink-500">
              {t("attendance.resolvedTotal")}: {total}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-8">
            {callRows.length > 0 ? (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-ink-50">{t("attendance.wavoipCallsTitle")}</h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    {callRows.length}
                  </span>
                </div>
                <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
                  {callRows.map((call) => {
                    const when = call.endedAt ?? call.createdAt;
                    const dirLabel =
                      call.direction === "OUTGOING"
                        ? t("attendance.wavoipCallOutbound")
                        : t("attendance.wavoipCallInbound");
                    const target = call.conversationId
                      ? `/conversations/${call.conversationId}`
                      : call.contact
                        ? `/contacts/${call.contact.id}`
                        : null;
                    const inner = (
                      <>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <PhoneCall className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-ink-50">
                              {call.contact?.name ?? call.contact?.phone ?? "—"}
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                              {dirLabel}
                            </span>
                            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-300">
                              {callStatusLabel(call.status)}
                            </span>
                            {call.durationSec != null && call.durationSec > 0 ? (
                              <span className="text-[10px] text-gray-500 dark:text-ink-400">
                                {t("contactDetail.timelineCallDuration")}: {call.durationSec}s
                              </span>
                            ) : null}
                          </div>
                          {call.contact?.phone ? (
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-ink-400">{call.contact.phone}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-ink-500">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(when), { addSuffix: true, locale: dateLocale })}
                        </div>
                      </>
                    );
                    return (
                      <motion.li key={call.id} variants={staggerItem}>
                        {target ? (
                          <Link
                            to={target}
                            className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-emerald-900/40 dark:bg-ink-900/50 dark:hover:border-emerald-800/60"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200/80 bg-white p-4 shadow-sm dark:border-emerald-900/40 dark:bg-ink-900/50">
                            {inner}
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </motion.ul>
              </section>
            ) : null}

            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-500 dark:border-ink-600 dark:bg-ink-900/40 dark:text-ink-400">
                {t("attendance.empty")}
              </p>
            ) : (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-ink-50">{t("attendance.closuresTitle")}</h2>
                <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
                  {rows.map((r) => {
                    const last = r.messages?.[0];
                    const rowRollup = {
                      conversationId: r.conversationId,
                      sessionIndex: r.sessionIndex,
                      closureValue: r.closureValue,
                      leadType: r.leadType,
                    };
                    const showValue = shouldDisplayClosureValueBadge(rowRollup, rollupRows);
                    const pipelineSuperseded =
                      r.leadType?.valueRollup === "PIPELINE" &&
                      (r.closureValue ?? 0) > 0 &&
                      !isPipelineClosureActiveForRollup(rowRollup, rollupRows);
                    return (
                      <motion.li key={r.id} variants={staggerItem}>
                        <Link
                          to={`/conversations/${r.conversationId}`}
                          className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-ink-700 dark:bg-ink-900/50 dark:hover:border-ink-600"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                            {r.contact.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-ink-50">{r.contact.name}</span>
                              {r.sessionIndex > 1 ? (
                                <span className="text-[10px] text-gray-500 dark:text-ink-400">
                                  {t("conversationDetail.attendanceSession")} #{r.sessionIndex}
                                </span>
                              ) : null}
                              <span
                                className={
                                  r.reopenedAt
                                    ? "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                    : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                }
                              >
                                {r.reopenedAt ? t("audit.statusReopened") : t("audit.statusResolved")}
                              </span>
                              {r.isNewAttendance ? (
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                                  {t("conversationDetail.attendanceNew")}
                                </span>
                              ) : null}
                              {r.leadType ? (
                                <span
                                  className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                                  style={{ backgroundColor: r.leadType.color }}
                                >
                                  {r.leadType.name}
                                </span>
                              ) : null}
                              {showValue ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                                  {fmtMoney(r.closureValue!)}
                                </span>
                              ) : pipelineSuperseded ? (
                                <span className="text-[10px] text-gray-400 line-through dark:text-ink-500">
                                  {fmtMoney(r.closureValue!)}
                                </span>
                              ) : null}
                            </div>
                            {pipelineSuperseded ? (
                              <p className="mt-0.5 text-[10px] text-gray-400 dark:text-ink-500">
                                {t("attendance.pipelineSupersededHint")}
                              </p>
                            ) : null}
                            <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-ink-400">
                              {r.closureReason || last?.body || "—"}
                            </p>
                            {r.team ? (
                              <p className="mt-1 text-xs text-gray-400 dark:text-ink-500">
                                {t("conversationDetail.team")}: {r.team.name}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-ink-500">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(r.resolvedAt), {
                              addSuffix: true,
                              locale: dateLocale,
                            })}
                          </div>
                        </Link>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              </section>
            )}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
