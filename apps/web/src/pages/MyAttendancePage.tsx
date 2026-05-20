import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ClipboardCheck, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCurrencyUnits } from "@/lib/currency";

interface Row {
  id: string;
  status: string;
  updatedAt: string;
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
  const [loading, setLoading] = useState(true);
  const hasAnimated = useRef(false);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  useEffect(() => {
    async function load() {
      if (!hasAnimated.current) setLoading(true);
      try {
        const res = await api.get<{ data: Row[] }>(
          "/conversations?mine=1&status=RESOLVED&pageSize=100",
        );
        setRows(res.data);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const contribution = (r: Row): "WON" | "PIPELINE" | "IGNORE" => {
    const v = r.closureValue ?? 0;
    if (v <= 0) return "IGNORE";
    const roll = r.leadType?.valueRollup ?? "PIPELINE";
    if (roll === "WON") return "WON";
    if (roll === "PIPELINE") return "PIPELINE";
    return "IGNORE";
  };

  const totalWonValue = rows.reduce(
    (a, r) => a + (contribution(r) === "WON" ? (r.closureValue ?? 0) : 0),
    0,
  );
  const totalPipelineValue = rows.reduce(
    (a, r) => a + (contribution(r) === "PIPELINE" ? (r.closureValue ?? 0) : 0),
    0,
  );

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="ds-page-heading">{t("attendance.title")}</h1>
              <p className="ds-page-subtitle mt-1">{t("attendance.subtitle")}</p>
            </div>
          </div>
          <div className="ds-panel px-4 py-3 text-sm">
            <p className="text-ink-500 dark:text-ink-400">{t("attendance.totalValue")}</p>
            <p className="text-lg font-semibold text-ink-900 dark:text-ink-50">{fmtMoney(totalWonValue)}</p>
            <p className="mt-2 text-xs font-medium text-ink-600 dark:text-ink-400">{t("attendance.negotiationSubtotal")}</p>
            <p className="text-base font-semibold text-ink-800 dark:text-ink-200">{fmtMoney(totalPipelineValue)}</p>
            <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">{t("attendance.negotiationSubtotalHint")}</p>
            <p className="mt-2 border-t border-ink-100 pt-2 text-xs text-ink-400 dark:border-white/5 dark:text-ink-500">
              {t("attendance.resolvedTotal")}: {rows.length}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <p className="ds-empty-state">
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
              const last = r.messages[0];
              return (
                <motion.li key={r.id} variants={staggerItem}>
                  <Link
                    to={`/conversations/${r.id}`}
                    className="ds-panel flex flex-wrap items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md dark:hover:bg-white/[0.06]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                      {r.contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900 dark:text-ink-50">{r.contact.name}</span>
                        {r.leadType ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: r.leadType.color }}
                          >
                            {r.leadType.name}
                          </span>
                        ) : null}
                        {r.closureValue != null && r.closureValue > 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            {fmtMoney(r.closureValue)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-500 dark:text-ink-400">
                        {r.closureReason || last?.body || "—"}
                      </p>
                      {r.team ? (
                        <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">
                          {t("conversationDetail.team")}: {r.team.name}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-ink-400 dark:text-ink-500">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(r.updatedAt), {
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
