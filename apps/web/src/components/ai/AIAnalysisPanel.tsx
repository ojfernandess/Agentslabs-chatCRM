import clsx from "clsx";
import { AlertTriangle, Brain, Lightbulb, Smile, Target, TrendingUp } from "lucide-react";
import { motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import {
  primaryRiskFromInsights,
  sentimentLabelKey,
  sentimentProgress,
  type ConversationInsightPayload,
} from "@/lib/conversationInsights";

type Props = {
  insights: ConversationInsightPayload | null;
  analyzing: boolean;
  hasSelection: boolean;
  analyzedAt: Date | null;
};

function sentimentClass(s: string): string {
  switch (s) {
    case "positive":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "negative":
    case "frustrated":
      return "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-100";
    default:
      return "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100";
  }
}

export function AIAnalysisPanel({ insights, analyzing, hasSelection, analyzedAt }: Props) {
  const { t } = useI18n();

  if (analyzing) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-brand-200/80 bg-gradient-to-br from-brand-50/50 to-violet-50/30 p-8 dark:border-brand-800/40 dark:from-brand-950/20 dark:to-violet-950/10">
        <Brain className="h-10 w-10 animate-pulse text-brand-500" />
        <p className="mt-4 text-sm font-medium text-ink-700 dark:text-ink-200">{t("aiInsightsPage.analyzing")}</p>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-8 text-center dark:border-ink-700 dark:bg-ink-900/30">
        <Brain className="h-10 w-10 text-ink-300 dark:text-ink-600" />
        <p className="mt-4 max-w-sm text-sm font-medium text-ink-700 dark:text-ink-300">
          {hasSelection ? t("aiInsightsPage.analysisEmptyHint") : t("aiInsightsPage.selectToAnalyze")}
        </p>
      </div>
    );
  }

  const progress = sentimentProgress(insights.sentiment);
  const risk = primaryRiskFromInsights(insights);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.analysisResult")}</h2>
        {analyzedAt ? (
          <span className="text-[10px] text-ink-500">
            {analyzedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {t("aiInsightsPage.today")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <InsightCard
          icon={Smile}
          label={t("aiInsightsPage.detectedSentiment")}
          accent="emerald"
          value={t(sentimentLabelKey(insights.sentiment))}
          badgeClass={sentimentClass(insights.sentiment)}
        />
        <InsightCard
          icon={Target}
          label={t("aiInsightsPage.mainIntent")}
          accent="violet"
          value={insights.intent}
        />
        <div className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-sm dark:border-ink-700/60 dark:bg-ink-900/50 sm:col-span-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-600 dark:text-ink-400">
            <TrendingUp className="h-4 w-4 text-brand-500" />
            {t("aiInsightsPage.closeProbability")}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-3xl font-bold text-ink-900 dark:text-ink-50">{progress}%</span>
            <span className="text-xs text-ink-500">{insights.conversionOutlook.split(/[.!?]/)[0]}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {risk ? (
          <InsightCard
            icon={AlertTriangle}
            label={t("aiInsightsPage.identifiedRisk")}
            accent="amber"
            value={risk}
            className="sm:col-span-2"
          />
        ) : null}
      </div>

      <div className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50/80 to-brand-50/40 p-5 shadow-sm dark:border-violet-900/40 dark:from-violet-950/20 dark:to-brand-950/10">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-900 dark:text-violet-200">
          <Lightbulb className="h-4 w-4" />
          {t("aiInsightsPage.aiSuggestion")}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-800 dark:text-ink-200">{insights.summary}</p>
        {insights.suggestedActions.length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-violet-200/60 pt-3 dark:border-violet-900/40">
            {insights.suggestedActions.slice(0, 3).map((action, i) => (
              <li key={i} className="flex gap-2 text-xs text-ink-700 dark:text-ink-300">
                <span className="font-bold text-brand-500">→</span>
                {action}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </motion.div>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
  accent,
  badgeClass,
  className,
}: {
  icon: typeof Smile;
  label: string;
  value: string;
  accent: "emerald" | "violet" | "amber";
  badgeClass?: string;
  className?: string;
}) {
  const ring =
    accent === "emerald"
      ? "border-emerald-200/80 dark:border-emerald-900/40"
      : accent === "amber"
        ? "border-amber-200/80 dark:border-amber-900/40"
        : "border-violet-200/80 dark:border-violet-900/40";

  return (
    <div className={clsx("rounded-2xl border bg-white p-4 shadow-sm dark:bg-ink-900/50", ring, className)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-500 dark:text-ink-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      {badgeClass ? (
        <span className={clsx("mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold", badgeClass)}>{value}</span>
      ) : (
        <p className="mt-3 text-sm font-semibold leading-snug text-ink-900 dark:text-ink-50">{value}</p>
      )}
    </div>
  );
}
