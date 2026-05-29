import clsx from "clsx";
import { AlertTriangle, BarChart3, Clock, DollarSign, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { InsightMetricCard } from "@/lib/conversationInsights";

const ICONS = {
  flame: Flame,
  alert: AlertTriangle,
  money: DollarSign,
  clock: Clock,
  chart: BarChart3,
} as const;

const ACCENT = {
  emerald: "from-emerald-500/10 to-emerald-500/5 border-emerald-200/80 text-emerald-700 dark:border-emerald-800/50 dark:text-emerald-300",
  amber: "from-amber-500/10 to-amber-500/5 border-amber-200/80 text-amber-700 dark:border-amber-800/50 dark:text-amber-300",
  sky: "from-sky-500/10 to-sky-500/5 border-sky-200/80 text-sky-700 dark:border-sky-800/50 dark:text-sky-300",
  violet: "from-violet-500/10 to-violet-500/5 border-violet-200/80 text-violet-700 dark:border-violet-800/50 dark:text-violet-300",
  brand: "from-brand-500/10 to-brand-500/5 border-brand-200/80 text-brand-700 dark:border-brand-800/50 dark:text-brand-300",
} as const;

type Props = {
  metrics: InsightMetricCard[];
};

export function InsightMetricCards({ metrics }: Props) {
  const { t } = useI18n();

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((m) => {
        const Icon = ICONS[m.icon];
        const accent = ACCENT[m.accent as keyof typeof ACCENT] ?? ACCENT.brand;
        const TrendIcon = m.trend === "down" ? TrendingDown : TrendingUp;
        return (
          <div
            key={m.id}
            className={clsx(
              "group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm transition-shadow hover:shadow-md dark:bg-ink-900/40",
              accent,
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm dark:bg-ink-900/60">
                <Icon className="h-5 w-5" />
              </div>
              {m.trend !== "neutral" && !m.hideTrend ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold dark:bg-ink-900/50">
                  <TrendIcon className="h-3 w-3" />
                  {m.change}
                </span>
              ) : m.hideTrend ? null : (
                <span className="text-[10px] font-semibold opacity-70">{m.change}</span>
              )}
            </div>
            <p className="mt-4 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{m.value}</p>
            <p className="mt-1 text-xs font-medium text-ink-600 dark:text-ink-400">{t(m.labelKey)}</p>
            <p className="mt-2 text-[10px] text-ink-500 dark:text-ink-500">
              {m.footnoteKey
                ? m.id === "opportunity" && !m.hideTrend
                  ? t(m.footnoteKey).replace("{count}", m.change)
                  : t(m.footnoteKey)
                : t("aiInsightsPage.metrics.vsLast7Days")}
            </p>
          </div>
        );
      })}
    </div>
  );
}
