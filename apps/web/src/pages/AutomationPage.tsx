import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Sparkles, RefreshCw, ExternalLink } from "lucide-react";
import { PageTransition } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { api } from "@/lib/api";

type Tab =
  | "overview"
  | "knowledge"
  | "agents"
  | "tools"
  | "prompts"
  | "interactions"
  | "context";

interface BotRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  isActive: boolean;
  syncToAi: boolean;
  botIds?: string[];
}

interface DashboardPayload {
  counts: {
    knowledgeArticles: number;
    agentProfiles: number;
    activeBots: number;
    interactionsToday: number;
    escalationsToday: number;
  };
  recentInteractions: Array<{
    id: string;
    userMessage: string;
    assistantMessage: string;
    escalatedToHuman: boolean;
    createdAt: string;
    bot: { name: string };
  }>;
}

const defaultLlm = {
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 1024,
  apiBaseUrl: null as string | null,
  apiKey: null as string | null,
};

const defaultBehavior = {
  nativeTools: {
    knowledge_search: true,
    call_human: true,
    end_conversation: false,
    list_entities: false,
    scheduling: false,
  },
  escalationRules: { conditions: "", transferMessage: "", mode: "keyword" },
  inactivity: {
    timeoutMinutes: 30,
    followUpMax: 0,
    followUpMessages: [] as string[],
    pauseMessage: "",
    closeMessage: "",
    clearContextAfterFollowUpMinutes: null as number | null,
  },
  voice: { elevenLabsEnabled: false, voiceId: null as string | null, replyWithAudioOnInboundAudio: false },
  segmentation: { segmentId: null, entityId: null, establishmentId: null },
  dataSource: { label: null as string | null, connectionRef: null as string | null },
  scheduling: { useOrgReminders: true, externalCalendar: "none" },
};

export function AutomationPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeArticle[] | null>(null);
  const [prompts, setPrompts] = useState<
    Array<{ id: string; name: string; slug: string; body: string; version: number }>
  >([]);
  const [tools, setTools] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      toolType: string;
      isActive: boolean;
      botId: string | null;
    }>
  >([]);
  const [interactions, setInteractions] = useState<
    Array<{
      id: string;
      userMessage: string;
      assistantMessage: string;
      escalatedToHuman: boolean;
      createdAt: string;
      bot: { name: string };
    }>
  >([]);

  const [kbForm, setKbForm] = useState({
    id: "" as string | null,
    title: "",
    content: "",
    category: "",
    tags: "",
    isActive: true,
    syncToAi: true,
    botIds: [] as string[],
  });

  const [agentBotId, setAgentBotId] = useState("");
  const [llmJson, setLlmJson] = useState(JSON.stringify(defaultLlm, null, 2));
  const [behaviorJson, setBehaviorJson] = useState(JSON.stringify(defaultBehavior, null, 2));
  const [promptModuleIdsJson, setPromptModuleIdsJson] = useState("[]");

  const loadBots = useCallback(async () => {
    const res = await api.get<{ data: BotRow[] }>("/bots");
    setBots(res.data);
  }, []);

  const loadDashboard = useCallback(async () => {
    const res = await api.get<DashboardPayload>("/automation/dashboard");
    setDashboard(res);
  }, []);

  const loadKnowledge = useCallback(async () => {
    const res = await api.get<{ data: KnowledgeArticle[] }>("/automation/knowledge-articles");
    setArticles(res.data.map((a) => ({ ...a, botIds: (a as KnowledgeArticle).botIds ?? [] })));
  }, []);

  const loadPrompts = useCallback(async () => {
    const res = await api.get<{ data: typeof prompts }>("/automation/prompt-modules");
    setPrompts(res.data);
  }, []);

  const loadTools = useCallback(async () => {
    const res = await api.get<{ data: typeof tools }>("/automation/custom-tools");
    setTools(res.data);
  }, []);

  const loadInteractions = useCallback(async () => {
    const res = await api.get<{ data: typeof interactions }>("/automation/interactions");
    setInteractions(res.data);
  }, []);

  const refreshTab = useCallback(async () => {
    if (!tenantAdmin) return;
    setLoading(true);
    setError("");
    try {
      if (tab === "overview") await loadDashboard();
      if (tab === "knowledge") {
        await loadKnowledge();
        await loadBots();
      }
      if (tab === "agents") await loadBots();
      if (tab === "tools") await loadTools();
      if (tab === "prompts") await loadPrompts();
      if (tab === "interactions") await loadInteractions();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, [tenantAdmin, tab, loadDashboard, loadKnowledge, loadBots, loadTools, loadPrompts, loadInteractions]);

  useEffect(() => {
    void refreshTab();
  }, [refreshTab]);

  useEffect(() => {
    if (tab !== "agents" || !agentBotId || !tenantAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<{ data: Array<{ botId: string; llmConfig: unknown; behaviorConfig: unknown; promptModuleIds: unknown }> }>(
          "/automation/agent-profiles",
        );
        const found = list.data.find((p) => p.botId === agentBotId);
        if (cancelled) return;
        if (found) {
          setLlmJson(JSON.stringify(found.llmConfig ?? defaultLlm, null, 2));
          setBehaviorJson(JSON.stringify(found.behaviorConfig ?? defaultBehavior, null, 2));
          setPromptModuleIdsJson(JSON.stringify(found.promptModuleIds ?? [], null, 2));
        } else {
          setLlmJson(JSON.stringify(defaultLlm, null, 2));
          setBehaviorJson(JSON.stringify(defaultBehavior, null, 2));
          setPromptModuleIdsJson("[]");
        }
      } catch {
        if (!cancelled) setError("load_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, agentBotId, tenantAdmin]);

  if (!tenantAdmin) {
    return (
      <PageTransition>
        <div className="p-8">
          <p className="text-ink-600 dark:text-ink-400">{t("automationPage.adminOnly")}</p>
        </div>
      </PageTransition>
    );
  }

  const saveKb = async () => {
    setLoading(true);
    setError("");
    try {
      const tags = kbForm.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (kbForm.id) {
        await api.patch(`/automation/knowledge-articles/${kbForm.id}`, {
          title: kbForm.title,
          content: kbForm.content,
          category: kbForm.category || null,
          tags,
          isActive: kbForm.isActive,
          syncToAi: kbForm.syncToAi,
          botIds: kbForm.botIds,
        });
      } else {
        await api.post("/automation/knowledge-articles", {
          title: kbForm.title,
          content: kbForm.content,
          category: kbForm.category || null,
          tags,
          isActive: kbForm.isActive,
          syncToAi: kbForm.syncToAi,
          botIds: kbForm.botIds,
        });
      }
      setKbForm({
        id: null,
        title: "",
        content: "",
        category: "",
        tags: "",
        isActive: true,
        syncToAi: true,
        botIds: [],
      });
      await loadKnowledge();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteKb = async (id: string) => {
    if (!window.confirm("Delete this article?")) return;
    await api.delete(`/automation/knowledge-articles/${id}`);
    await loadKnowledge();
  };

  const runSearch = async () => {
    if (!searchQ.trim()) return;
    setLoading(true);
    try {
      const res = await api.post<{ data: KnowledgeArticle[] }>("/automation/knowledge-articles/search", {
        query: searchQ.trim(),
        botId: kbForm.botIds[0] || undefined,
      });
      setSearchResults(res.data);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const saveAgentProfile = async () => {
    if (!agentBotId) return;
    setLoading(true);
    setError("");
    try {
      const llmConfig = JSON.parse(llmJson) as Record<string, unknown>;
      const behaviorConfig = JSON.parse(behaviorJson) as Record<string, unknown>;
      const promptModuleIds = JSON.parse(promptModuleIdsJson) as string[];
      await api.put(`/automation/agent-profiles/${agentBotId}`, {
        llmConfig,
        behaviorConfig,
        promptModuleIds,
      });
      await loadDashboard();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: t("automationPage.tabOverview") },
    { id: "knowledge", label: t("automationPage.tabKnowledge") },
    { id: "agents", label: t("automationPage.tabAgents") },
    { id: "tools", label: t("automationPage.tabTools") },
    { id: "prompts", label: t("automationPage.tabPrompts") },
    { id: "interactions", label: t("automationPage.tabInteractions") },
    { id: "context", label: t("automationPage.tabContext") },
  ];

  return (
    <PageTransition>
      <div className="flex min-h-full flex-col gap-6 p-6 sm:p-8">
        <header className="flex flex-col gap-3 border-b border-ink-200 pb-6 dark:border-ink-800 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400">
              <Sparkles className="h-6 w-6" />
              <span className="text-xs font-semibold uppercase tracking-wide">Automation</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">{t("automationPage.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-ink-600 dark:text-ink-400">{t("automationPage.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshTab()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
          >
            <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
            {t("automationPage.refresh")}
          </button>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {t("automationPage.loadError")}
          </div>
        ) : null}

        <nav className="flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-ink-50/80 p-1 dark:border-ink-800 dark:bg-ink-900/40">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={clsx(
                "rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm",
                tab === x.id
                  ? "bg-white text-brand-700 shadow-sm dark:bg-ink-800 dark:text-brand-300"
                  : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
              )}
            >
              {x.label}
            </button>
          ))}
        </nav>

        {tab === "overview" && dashboard ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label={t("automationPage.countsKnowledge")} value={dashboard.counts.knowledgeArticles} />
            <Stat label={t("automationPage.countsProfiles")} value={dashboard.counts.agentProfiles} />
            <Stat label={t("automationPage.countsBots")} value={dashboard.counts.activeBots} />
            <Stat label={t("automationPage.countsInteractionsToday")} value={dashboard.counts.interactionsToday} />
            <Stat label={t("automationPage.countsEscalations")} value={dashboard.counts.escalationsToday} />
            <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <p className="text-xs font-semibold text-ink-500 dark:text-ink-400">{t("automationPage.linkBots")}</p>
              <Link
                to="/bots"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Bots
              </Link>
              <p className="mt-3 text-xs font-semibold text-ink-500 dark:text-ink-400">{t("automationPage.linkReminders")}</p>
              <Link
                to="/reminders"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Reminders
              </Link>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Recent</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {dashboard.recentInteractions.map((r) => (
                  <li key={r.id} className="rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-800/50">
                    <span className="text-xs text-ink-500">{r.bot.name}</span>
                    <p className="text-ink-800 dark:text-ink-200">{r.userMessage.slice(0, 120)}</p>
                    {r.escalatedToHuman ? (
                      <span className="text-xs text-amber-700 dark:text-amber-300">escalated</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {tab === "knowledge" ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder={t("automationPage.kbSearchPlaceholder")}
                className="min-w-[200px] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {t("automationPage.kbSearch")}
              </button>
            </div>
            {searchResults ? (
              <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <p className="text-xs font-semibold text-ink-500">Results ({searchResults.length})</p>
                <ul className="mt-2 space-y-2">
                  {searchResults.map((a) => (
                    <li key={a.id} className="text-sm">
                      <span className="font-medium">{a.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <h3 className="text-sm font-semibold">{kbForm.id ? t("automationPage.kbEdit") : t("automationPage.kbNew")}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.kbTitle")}
                  <input
                    value={kbForm.title}
                    onChange={(e) => setKbForm((f) => ({ ...f, title: e.target.value }))}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
                  />
                </label>
                <label className="text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.kbCategory")}
                  <input
                    value={kbForm.category}
                    onChange={(e) => setKbForm((f) => ({ ...f, category: e.target.value }))}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                {t("automationPage.kbContent")}
                <textarea
                  value={kbForm.content}
                  onChange={(e) => setKbForm((f) => ({ ...f, content: e.target.value }))}
                  rows={5}
                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
              </label>
              <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                {t("automationPage.kbTags")}
                <input
                  value={kbForm.tags}
                  onChange={(e) => setKbForm((f) => ({ ...f, tags: e.target.value }))}
                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={kbForm.isActive}
                    onChange={(e) => setKbForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  {t("automationPage.kbActive")}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={kbForm.syncToAi}
                    onChange={(e) => setKbForm((f) => ({ ...f, syncToAi: e.target.checked }))}
                  />
                  {t("automationPage.kbSyncAi")}
                </label>
              </div>
              <fieldset className="mt-3">
                <legend className="text-xs font-medium text-ink-600 dark:text-ink-400">{t("automationPage.kbBots")}</legend>
                <div className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto rounded border border-ink-100 p-2 dark:border-ink-700">
                  {bots.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={kbForm.botIds.includes(b.id)}
                        onChange={(e) => {
                          setKbForm((f) => ({
                            ...f,
                            botIds: e.target.checked
                              ? [...f.botIds, b.id]
                              : f.botIds.filter((id) => id !== b.id),
                          }));
                        }}
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                onClick={() => void saveKb()}
                disabled={loading || !kbForm.title.trim() || !kbForm.content.trim()}
                className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t("automationPage.kbSave")}
              </button>
            </div>

            <div className="rounded-xl border border-ink-200 dark:border-ink-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-800/50">
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {articles.map((a) => (
                    <tr key={a.id} className="border-b border-ink-100 dark:border-ink-800">
                      <td className="px-3 py-2">{a.title}</td>
                      <td className="px-3 py-2">{a.isActive ? "yes" : "no"}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-brand-600 text-xs font-medium"
                          onClick={() =>
                            setKbForm({
                              id: a.id,
                              title: a.title,
                              content: a.content,
                              category: a.category ?? "",
                              tags: (a.tags ?? []).join(", "),
                              isActive: a.isActive,
                              syncToAi: a.syncToAi,
                              botIds: a.botIds ?? [],
                            })
                          }
                        >
                          {t("automationPage.kbEdit")}
                        </button>
                        <button
                          type="button"
                          className="ml-2 text-red-600 text-xs"
                          onClick={() => void deleteKb(a.id)}
                        >
                          {t("automationPage.kbDelete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "agents" ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-600 dark:text-ink-400">{t("automationPage.agentHint")}</p>
            <label className="block text-xs font-medium">
              {t("automationPage.agentSelectBot")}
              <select
                value={agentBotId}
                onChange={(e) => setAgentBotId(e.target.value)}
                className="mt-1 w-full max-w-md rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              >
                <option value="">—</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              {t("automationPage.agentLlmJson")}
              <textarea
                value={llmJson}
                onChange={(e) => setLlmJson(e.target.value)}
                rows={8}
                className="mt-1 w-full font-mono text-xs rounded border border-ink-200 p-2 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="block text-xs font-medium">
              {t("automationPage.agentBehaviorJson")}
              <textarea
                value={behaviorJson}
                onChange={(e) => setBehaviorJson(e.target.value)}
                rows={12}
                className="mt-1 w-full font-mono text-xs rounded border border-ink-200 p-2 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="block text-xs font-medium">
              {t("automationPage.agentPromptModules")}
              <textarea
                value={promptModuleIdsJson}
                onChange={(e) => setPromptModuleIdsJson(e.target.value)}
                rows={3}
                className="mt-1 w-full font-mono text-xs rounded border border-ink-200 p-2 dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <button
              type="button"
              disabled={!agentBotId || loading}
              onClick={() => void saveAgentProfile()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("automationPage.agentSaveProfile")}
            </button>
          </div>
        ) : null}

        {tab === "prompts" ? (
          <div className="text-sm text-ink-600 dark:text-ink-400">
            <p className="mb-4">{t("automationPage.promptNew")} — use API POST /api/v1/automation/prompt-modules or expand this UI later.</p>
            <ul className="space-y-2">
              {prompts.map((p) => (
                <li key={p.id} className="rounded border border-ink-200 px-3 py-2 dark:border-ink-700">
                  <span className="font-medium">{p.name}</span> <code className="text-xs opacity-70">{p.slug}</code> v{p.version}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "tools" ? (
          <div className="text-sm text-ink-600 dark:text-ink-400">
            <p className="mb-4">Custom tools (HTTP / EMAIL / …). Create via POST /api/v1/automation/custom-tools.</p>
            <ul className="space-y-2">
              {tools.map((tool) => (
                <li key={tool.id} className="rounded border border-ink-200 px-3 py-2 dark:border-ink-700">
                  <span className="font-medium">{tool.name}</span> ({tool.toolType}) {tool.isActive ? "" : "[off]"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "interactions" ? (
          <div className="space-y-2">
            {interactions.length === 0 ? (
              <p className="text-sm text-ink-500">{t("automationPage.interactionsEmpty")}</p>
            ) : (
              interactions.map((r) => (
                <div key={r.id} className="rounded-lg border border-ink-200 p-3 text-sm dark:border-ink-700">
                  <div className="text-xs text-ink-500">{r.bot.name}</div>
                  <p className="mt-1 font-medium text-ink-900 dark:text-ink-100">{r.userMessage.slice(0, 200)}</p>
                  <p className="mt-1 text-ink-600 dark:text-ink-400">{r.assistantMessage.slice(0, 300)}</p>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "context" ? (
          <div className="max-w-2xl space-y-4 text-sm text-ink-700 dark:text-ink-300">
            <p>{t("automationPage.contextBlurb")}</p>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
      <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{value}</p>
    </div>
  );
}
