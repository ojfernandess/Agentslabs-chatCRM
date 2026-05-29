import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { PageTransition } from "@/components/Motion";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { AIAnalysisPanel } from "@/components/ai/AIAnalysisPanel";
import { ConversationListPanel } from "@/components/ai/ConversationListPanel";
import { ConversationPreview } from "@/components/ai/ConversationPreview";
import { InsightMetricCards } from "@/components/ai/InsightMetricCards";
import { SmartAlerts, SuggestedActions, type SmartAlertItem } from "@/components/ai/SuggestedActions";
import { formatCurrencyUnits } from "@/lib/currency";
import {
  buildInsightMetrics,
  conversationHasLeadValue,
  type AiInsightsConversationRow,
  type ConversationInsightPayload,
} from "@/lib/conversationInsights";
import clsx from "clsx";
import { Brain, Copy, Settings, Sparkles, X } from "lucide-react";

export function AiInsightsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<AiInsightsConversationRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(() => searchParams.get("conversation") ?? "");
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("7");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [insights, setInsights] = useState<ConversationInsightPayload | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<Date | null>(null);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);

  const [assistantAiEnabled, setAssistantAiEnabled] = useState(true);
  const [aiPilotAccessEnabled, setAiPilotAccessEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    void api
      .get<{ assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean }>("/settings/pilot")
      .then((res) => {
        if (!cancelled) {
          setAssistantAiEnabled(res.assistantAiEnabled);
          setAiPilotAccessEnabled(res.aiPilotAccessEnabled);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssistantAiEnabled(true);
          setAiPilotAccessEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.get<{ data: AiInsightsConversationRow[] }>("/conversations?pageSize=50"),
      api.get<{ id: string; name: string }[]>("/users").catch(() => []),
      api.get<{ id: string; name: string }[]>("/tags").catch(() => []),
    ])
      .then(([convRes, users, tagRows]) => {
        if (cancelled) return;
        setRows(convRes.data ?? []);
        setAgents(users.map((u) => ({ id: u.id, name: u.name })));
        setTags(tagRows.map((tag) => ({ id: tag.id, name: tag.name })));
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

  useEffect(() => {
    const c = searchParams.get("conversation");
    if (c) setSelectedId(c);
  }, [searchParams]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const periodDays = periodFilter === "all" ? null : Number(periodFilter);
    const cutoff = periodDays ? Date.now() - periodDays * 86400000 : null;

    return rows.filter((row) => {
      if (q) {
        const hay = `${row.contact.name} ${row.contact.phone}`.toLowerCase();
        const tagNames = row.contact.tags?.map((t) => t.tag.name.toLowerCase()).join(" ") ?? "";
        if (!hay.includes(q) && !tagNames.includes(q)) return false;
      }
      if (agentFilter && row.assignedTo?.id !== agentFilter) return false;
      if (tagFilter && !row.contact.tags?.some((t) => t.tag.id === tagFilter)) return false;
      if (cutoff && new Date(row.updatedAt).getTime() < cutoff) return false;
      return true;
    });
  }, [rows, search, agentFilter, tagFilter, periodFilter]);

  const selectedConversation = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const metrics = useMemo(
    () => buildInsightMetrics(rows, analyzedCount, t, formatCurrencyUnits),
    [rows, analyzedCount, t],
  );

  const smartAlerts = useMemo((): SmartAlertItem[] => {
    const alerts: SmartAlertItem[] = [];
    const now = Date.now();

    for (const row of rows.slice(0, 20)) {
      if (row.isUnread && row.status === "OPEN") {
        alerts.push({
          id: `hot-${row.id}`,
          type: "hot",
          titleKey: "aiInsightsPage.alerts.hotLead",
          bodyKey: "aiInsightsPage.alerts.hotLeadBody",
          bodyParams: { name: row.contact.name },
          conversationId: row.id,
          timeKey: "aiInsightsPage.alerts.now",
        });
        break;
      }
    }

    for (const row of rows) {
      const age = now - new Date(row.updatedAt).getTime();
      if (row.status === "PENDING" && age > 3600000) {
        alerts.push({
          id: `wait-${row.id}`,
          type: "waiting",
          titleKey: "aiInsightsPage.alerts.longWait",
          bodyKey: "aiInsightsPage.alerts.longWaitBody",
          bodyParams: { count: "1" },
          conversationId: row.id,
          timeKey: "aiInsightsPage.alerts.minutesAgo",
        });
        break;
      }
    }

    if (insights?.sentiment === "frustrated" || insights?.sentiment === "negative") {
      alerts.push({
        id: "insight-angry",
        type: "angry",
        titleKey: "aiInsightsPage.alerts.unhappy",
        bodyKey: "aiInsightsPage.alerts.unhappyBody",
        bodyParams: { name: selectedConversation?.contact.name ?? "—" },
        conversationId: selectedId || undefined,
        timeKey: "aiInsightsPage.alerts.now",
      });
    }

    const openWithLeadValue = rows.find(
      (r) => (r.status === "OPEN" || r.status === "PENDING") && conversationHasLeadValue(r),
    );
    if (openWithLeadValue) {
      alerts.push({
        id: `opp-${openWithLeadValue.id}`,
        type: "opportunity",
        titleKey: "aiInsightsPage.alerts.highOpportunity",
        bodyKey: "aiInsightsPage.alerts.highOpportunityBody",
        bodyParams: {
          name: openWithLeadValue.contact.name,
          value: formatCurrencyUnits(openWithLeadValue.closureValue ?? 0),
        },
        conversationId: openWithLeadValue.id,
        timeKey: "aiInsightsPage.alerts.recent",
      });
    }

    return alerts.slice(0, 4);
  }, [rows, insights, selectedConversation, selectedId]);

  const onSelectConversation = (id: string) => {
    setSelectedId(id);
    setSearchParams(id ? { conversation: id } : {}, { replace: true });
    setInsights(null);
    setAnalyzedAt(null);
    setGeneratedReply(null);
    setError("");
  };

  const toggleAi = useCallback(async () => {
    if (!tenantAdmin) return;
    const next = !assistantAiEnabled;
    try {
      await api.put("/settings", { assistantAiEnabled: next });
      setAssistantAiEnabled(next);
      window.dispatchEvent(
        new CustomEvent("openconduit:pilot-flags-updated", {
          detail: { assistantAiEnabled: next, aiPilotAccessEnabled },
        }),
      );
      setError("");
      setInsights(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("aiInsightsPage.analyzeError"));
    }
  }, [assistantAiEnabled, tenantAdmin, t, aiPilotAccessEnabled]);

  const togglePilot = useCallback(async () => {
    if (!tenantAdmin) return;
    const next = !aiPilotAccessEnabled;
    try {
      await api.put("/settings", { aiPilotAccessEnabled: next });
      setAiPilotAccessEnabled(next);
      window.dispatchEvent(
        new CustomEvent("openconduit:pilot-flags-updated", {
          detail: { assistantAiEnabled, aiPilotAccessEnabled: next },
        }),
      );
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("aiInsightsPage.analyzeError"));
    }
  }, [aiPilotAccessEnabled, tenantAdmin, t, assistantAiEnabled]);

  const runAnalyze = useCallback(async () => {
    if (!selectedId.trim() || !assistantAiEnabled) return;
    setAnalyzing(true);
    setError("");
    setSuccess("");
    setInsights(null);
    setGeneratedReply(null);
    try {
      const res = await api.post<{ insights: ConversationInsightPayload }>(`/conversations/${selectedId.trim()}/insights`, {});
      setInsights(res.insights);
      setAnalyzedAt(new Date());
      setAnalyzedCount((c) => c + 1);
      setSuccess(t("aiInsightsPage.analysisDone"));
    } catch (e) {
      if (e instanceof ApiError && (e as unknown as { code?: string }).code === "ai_disabled") {
        setAssistantAiEnabled(false);
        setError(t("aiInsightsPage.aiDisabled"));
      } else {
        setError(e instanceof ApiError ? e.message : t("aiInsightsPage.analyzeError"));
      }
    } finally {
      setAnalyzing(false);
    }
  }, [selectedId, t, assistantAiEnabled]);

  const runGenerateReply = useCallback(async () => {
    if (!selectedId.trim() || !assistantAiEnabled) return;
    setGenerating(true);
    setError("");
    try {
      const res = await api.post<{ suggestion: string }>(`/conversations/${selectedId.trim()}/suggest-reply`, {});
      setGeneratedReply(res.suggestion);
      setSuccess(t("aiInsightsPage.replyGenerated"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("conversationDetail.generateReplyError"));
    } finally {
      setGenerating(false);
    }
  }, [selectedId, assistantAiEnabled, t]);

  const copyReply = async () => {
    if (!generatedReply) return;
    try {
      await navigator.clipboard.writeText(generatedReply);
      setSuccess(t("aiInsightsPage.replyCopied"));
    } catch {
      setError(t("aiInsightsPage.copyFailed"));
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-[1400px] space-y-8 px-4 py-8 lg:px-6">
        <header className="relative overflow-hidden rounded-3xl border border-ink-200/80 bg-white p-6 shadow-sm dark:border-ink-700/60 dark:bg-ink-900/50 lg:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900 dark:border-violet-800/60 dark:bg-violet-950/50 dark:text-violet-100">
                <Brain className="h-3.5 w-3.5" />
                {t("aiInsightsPage.badge")}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{t("aiInsightsPage.title")}</h1>
              <p className="text-sm leading-relaxed text-ink-600 dark:text-ink-400">{t("aiInsightsPage.subtitlePremium")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {tenantAdmin ? (
                <>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/80 px-3 py-2 text-xs font-medium dark:border-ink-700 dark:bg-ink-800/40">
                    <span>{t("aiInsightsPage.autopilot")}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiPilotAccessEnabled}
                      onClick={() => void togglePilot()}
                      className={clsx(
                        "relative h-6 w-11 rounded-full transition-colors",
                        aiPilotAccessEnabled ? "bg-brand-500" : "bg-ink-300 dark:bg-ink-600",
                      )}
                    >
                      <span
                        className={clsx(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          aiPilotAccessEnabled ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </label>
                  <button
                    type="button"
                    onClick={() => void toggleAi()}
                    className={assistantAiEnabled ? "btn-secondary text-xs" : "btn-primary text-xs"}
                  >
                    {assistantAiEnabled ? t("aiInsightsPage.disableAi") : t("aiInsightsPage.enableAi")}
                  </button>
                </>
              ) : null}
              <Link to="/settings" className="btn-secondary inline-flex items-center gap-2 text-xs">
                <Settings className="h-4 w-4" />
                {t("aiInsightsPage.aiSettings")}
              </Link>
            </div>
          </div>
        </header>

        {!assistantAiEnabled ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
            {t("aiInsightsPage.aiDisabled")}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
            {success}
          </div>
        ) : null}

        <InsightMetricCards metrics={metrics} />

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <ConversationListPanel
              rows={filteredRows}
              loading={listLoading}
              selectedId={selectedId}
              search={search}
              onSearchChange={setSearch}
              agentFilter={agentFilter}
              onAgentFilterChange={setAgentFilter}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
              periodFilter={periodFilter}
              onPeriodFilterChange={setPeriodFilter}
              agents={agents}
              tags={tags}
              onSelect={onSelectConversation}
              onAnalyze={() => void runAnalyze()}
              analyzing={analyzing}
              analyzeDisabled={!assistantAiEnabled}
            />
          </div>

          <div className="space-y-5 xl:col-span-5">
            <div className="rounded-2xl border border-ink-200/80 bg-white p-5 shadow-sm dark:border-ink-700/60 dark:bg-ink-900/50">
              <AIAnalysisPanel
                insights={insights}
                analyzing={analyzing}
                hasSelection={Boolean(selectedId)}
                analyzedAt={analyzedAt}
              />
              <div className="mt-5 border-t border-ink-100 pt-5 dark:border-ink-800">
                <SuggestedActions
                  conversationId={selectedId}
                  onGenerateReply={() => void runGenerateReply()}
                  generating={generating}
                  disabled={!assistantAiEnabled}
                />
              </div>
              {selectedId ? (
                <p className="mt-3 text-xs">
                  <Link to={`/conversations/${selectedId}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {t("aiInsightsPage.openConversation")} →
                  </Link>
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 xl:col-span-3">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.previewTitle")}</h3>
              <ConversationPreview conversation={selectedConversation} insights={insights} />
            </div>
            {insights?.suggestedActions && insights.suggestedActions.length > 0 ? (
              <div className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-sm dark:border-ink-700/60 dark:bg-ink-900/50">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("aiInsightsPage.recommendedActions")}</h3>
                <ul className="mt-3 space-y-2">
                  {insights.suggestedActions.slice(0, 3).map((action, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2 text-xs dark:bg-ink-800/40">
                      <span className="text-ink-700 dark:text-ink-200">{action}</span>
                      <Link
                        to={`/conversations/${selectedId}`}
                        className="shrink-0 font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t("aiInsightsPage.execute")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <SmartAlerts alerts={smartAlerts} />

        {generatedReply ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-ink-900">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-ink-900 dark:text-ink-50">
                  <Sparkles className="h-5 w-5 text-brand-500" />
                  {t("aiInsightsPage.generatedReplyTitle")}
                </h3>
                <button type="button" onClick={() => setGeneratedReply(null)} className="btn-ghost rounded-lg p-2">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-700 dark:text-ink-200">{generatedReply}</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void copyReply()} className="btn-secondary inline-flex items-center gap-2">
                  <Copy className="h-4 w-4" />
                  {t("aiInsightsPage.copyReply")}
                </button>
                <Link to={`/conversations/${selectedId}`} className="btn-primary">
                  {t("aiInsightsPage.openConversation")}
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
