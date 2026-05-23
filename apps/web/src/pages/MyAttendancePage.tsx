import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ClipboardCheck, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCurrencyUnits } from "@/lib/currency";
import { computeClosureRollupTotals } from "@/lib/closureValueRollup";

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

export function MyAttendancePage() {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ wonValue: 0, pipelineValue: 0 });
  const [loading, setLoading] = useState(true);
  const hasAnimated = useRef(false);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  useEffect(() => {
    async function load() {
      if (!hasAnimated.current) setLoading(true);
      try {
        const res = await api.get<{
          data: Row[];
          total: number;
          summary?: { wonValue: number; pipelineValue: number };
        }>("/conversations/my-attendance?pageSize=100");
        setRows(res.data);
        setTotal(res.total);
        if (res.summary) {
          setSummary(res.summary);
        } else {
          setSummary(computeClosureRollupTotals(res.data));
        }
      } catch {
        setRows([]);
        setTotal(0);
        setSummary({ wonValue: 0, pipelineValue: 0 });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const totalWonValue = summary.wonValue;
  const totalPipelineValue = summary.pipelineValue;

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
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-500 dark:border-ink-600 dark:bg-ink-900/40 dark:text-ink-400">
            {t("attendance.empty")}
          </p>
        ) : (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-2"
          >
            {rows.map((r) => {
              const last = r.messages?.[0];
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
                        {r.closureValue != null && r.closureValue > 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                            {fmtMoney(r.closureValue)}
                          </span>
                        ) : null}
                      </div>
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
        )}
      </div>
    </PageTransition>
  );
}
