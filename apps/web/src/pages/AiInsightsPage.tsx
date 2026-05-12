import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { PageTransition, motion } from "@/components/Motion";
import {
  Brain,
  Loader2,
  MessageSquare,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  ListChecks,
} from "lucide-react";

interface ConversationListRow {
  id: string;
  status: string;
  contact: { name: string; phone: string };
}

type InsightPayload = {
  summary: string;
  intent: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  suggestedActions: string[];
  conversionOutlook: string;
  alerts: string[];
};

export function AiInsightsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ConversationListRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(() => searchParams.get("conversation") ?? "");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [insights, setInsights] = useState<InsightPayload | null>(null);

  useEffect(() => {
    const c = searchParams.get("conversation");
    if (c) setSelectedId(c);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    void api
      .get<{ data: ConversationListRow[] }>("/conversations?pageSize=50")
      .then((res) => {
        if (!cancelled) setRows(res.data);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelectConversation = (id: string) => {
    setSelectedId(id);
    setSearchParams(id ? { conversation: id } : {}, { replace: true });
    setInsights(null);
    setError("");
  };

  const runAnalyze = useCallback(async () => {
    if (!selectedId.trim()) return;
    setAnalyzing(true);
    setError("");
    setInsights(null);
    try {
      const res = await api.post<{ insights: InsightPayload }>(`/conversations/${selectedId.trim()}/insights`, {});
      setInsights(res.insights);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("aiInsightsPage.analyzeError"));
    } finally {
      setAnalyzing(false);
    }
  }, [selectedId, t]);

  const sentimentClass = (s: string) => {
    switch (s) {
      case "positive":
        return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100";
      case "negative":
      case "frustrated":
        return "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-100";
      default:
        return "bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100";
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-100">
            <Brain className="h-3.5 w-3.5" />
            {t("aiInsightsPage.badge")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{t("aiInsightsPage.title")}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">{t("aiInsightsPage.subtitle")}</p>
        </header>

        <section className="card-surface space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
            <MessageSquare className="h-4 w-4 text-brand-500" />
            {t("aiInsightsPage.analyzeSectionTitle")}
          </h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">{t("aiInsightsPage.analyzeSectionHelp")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="ai-insights-conv" className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                {t("aiInsightsPage.selectConversation")}
              </label>
              <select
                id="ai-insights-conv"
                className="input-field w-full"
                disabled={listLoading}
                value={selectedId}
                onChange={(e) => onSelectConversation(e.target.value)}
              >
                <option value="">{t("aiInsightsPage.selectPlaceholder")}</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.contact.name} · {r.status} · {r.contact.phone}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary inline-flex shrink-0 items-center justify-center gap-2"
              disabled={!selectedId || analyzing}
              onClick={() => void runAnalyze()}
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
              {analyzing ? t("aiInsightsPage.analyzing") : t("aiInsightsPage.analyzeButton")}
            </button>
          </div>
          {selectedId ? (
            <p className="text-xs">
              <Link to={`/conversations/${selectedId}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                {t("aiInsightsPage.openConversation")} →
              </Link>
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
              {error}
            </p>
          ) : null}
        </section>

        {insights ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <section className="card-surface p-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
                <ListChecks className="h-4 w-4 text-brand-500" />
                {t("aiInsightsPage.summary")}
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700 dark:text-ink-200">{insights.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sentimentClass(insights.sentiment)}`}>
                  {t("aiInsightsPage.sentiment")}: {insights.sentiment}
                </span>
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-950 dark:bg-sky-950/50 dark:text-sky-100">
                  {t("aiInsightsPage.intent")}: {insights.intent}
                </span>
              </div>
            </section>

            {insights.alerts.length > 0 ? (
              <section className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900/40 dark:bg-amber-950/25">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-950 dark:text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  {t("aiInsightsPage.alerts")}
                </h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-amber-950/95 dark:text-amber-100/90">
                  {insights.alerts.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="card-surface p-6">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
                <TrendingUp className="h-4 w-4 text-brand-500" />
                {t("aiInsightsPage.conversionOutlook")}
              </h3>
              <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">{insights.conversionOutlook}</p>
            </section>

            {insights.suggestedActions.length > 0 ? (
              <section className="card-surface p-6">
                <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.suggestedActions")}</h3>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-700 dark:text-ink-200">
                  {insights.suggestedActions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </section>
            ) : null}
          </motion.div>
        ) : null}

        <section className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-6 dark:border-ink-700 dark:bg-ink-900/30">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.visionTitle")}</h2>
          <ul className="mt-3 grid gap-2 text-xs text-ink-600 dark:text-ink-400 sm:grid-cols-2">
            <li>· {t("aiInsightsPage.visionBullet1")}</li>
            <li>· {t("aiInsightsPage.visionBullet2")}</li>
            <li>· {t("aiInsightsPage.visionBullet3")}</li>
            <li>· {t("aiInsightsPage.visionBullet4")}</li>
            <li>· {t("aiInsightsPage.visionBullet5")}</li>
            <li>· {t("aiInsightsPage.visionBullet6")}</li>
          </ul>
        </section>
      </div>
    </PageTransition>
  );
}
