import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Sparkles,
  RefreshCw,
  ExternalLink,
  Bot,
  MessageSquare,
  Pencil,
  Trash2,
  X,
  Volume2,
  Clock,
} from "lucide-react";
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
  description?: string | null;
  isActive: boolean;
  webhookUrl?: string | null;
  config?: unknown;
}

interface AgentProfileRow {
  id: string;
  botId: string;
  llmConfig: Record<string, unknown>;
  behaviorConfig: Record<string, unknown>;
  promptModuleIds: unknown;
  bot: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    webhookUrl: string | null;
    editInExternalAutomation: boolean;
    managedByOpenConduit: boolean;
  };
}

function botExternalWarning(bot: { webhookUrl?: string | null; config?: unknown }): boolean {
  const cfg = bot.config && typeof bot.config === "object" ? (bot.config as Record<string, unknown>) : {};
  const managed = cfg.automationManagedByOpenConduit === true;
  const hasWebhook = Boolean((bot.webhookUrl ?? "").trim());
  return hasWebhook && !managed;
}

const NATIVE_TOOL_KEYS = [
  "list_hotels",
  "get_hotel_info",
  "list_entities",
  "get_entity_info",
  "knowledge_search",
  "scheduling_google",
  "scheduling_outlook",
  "call_human",
  "end_conversation",
  "ping",
] as const;

type NativeToolKey = (typeof NATIVE_TOOL_KEYS)[number];

const DEFAULT_API_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  google_gemini: "https://generativelanguage.googleapis.com",
};

const PROVIDER_OPTIONS = [
  { value: "openai", labelKey: "automationPage.agentProviderOpenAI" as const },
  { value: "google_gemini", labelKey: "automationPage.agentProviderGemini" as const },
];

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  google_gemini: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
};

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
  systemInstructions: "",
};

function defaultNativeTools(): Record<NativeToolKey, boolean> {
  const o = {} as Record<NativeToolKey, boolean>;
  for (const k of NATIVE_TOOL_KEYS) o[k] = false;
  o.knowledge_search = true;
  o.call_human = true;
  return o;
}

const defaultBehavior = {
  nativeTools: defaultNativeTools(),
  escalationRules: { conditions: "", transferMessage: "", mode: "keyword" },
  inactivity: {
    automationEnabled: false,
    timeoutMinutes: 30,
    followUpMax: 1,
    followUpMessages: [] as string[],
    pauseMessage: "",
    closeMessage: "",
    clearContextAfterFollowUpMinutes: null as number | null,
  },
  voice: { elevenLabsEnabled: false, voiceId: null as string | null, replyWithAudioOnInboundAudio: false },
  segmentation: { segmentId: null as string | null, entityId: null as string | null, establishmentId: null as string | null },
  dataSource: { label: null as string | null, connectionRef: null as string | null },
  scheduling: { useOrgReminders: true, externalCalendar: "none" },
};

type AgentFormFields = {
  mode: "new" | "edit";
  createBot: boolean;
  existingBotId: string;
  editBotId: string | null;
  botName: string;
  botDescription: string;
  botIsActive: boolean;
  provider: string;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  systemInstructions: string;
  temperature: number;
  maxTokens: number;
  segmentId: string;
  entityId: string;
  establishmentId: string;
  dataSourcePreset: "default" | "custom";
  dataSourceRef: string;
  voiceEnabled: boolean;
  replyWithAudioOnInboundAudio: boolean;
  inactivityEnabled: boolean;
  inactivityTimeout: number;
  inactivityFollowUpMax: number;
  nativeTools: Record<NativeToolKey, boolean>;
  promptModuleIds: string[];
};

function emptyAgentForm(): AgentFormFields {
  return {
    mode: "new",
    createBot: true,
    existingBotId: "",
    editBotId: null,
    botName: "",
    botDescription: "",
    botIsActive: true,
    provider: "openai",
    model: "gpt-4o-mini",
    apiBaseUrl: DEFAULT_API_BASE.openai,
    apiKey: "",
    systemInstructions: "",
    temperature: 0.7,
    maxTokens: 1024,
    segmentId: "",
    entityId: "",
    establishmentId: "",
    dataSourcePreset: "default",
    dataSourceRef: "",
    voiceEnabled: false,
    replyWithAudioOnInboundAudio: false,
    inactivityEnabled: false,
    inactivityTimeout: 30,
    inactivityFollowUpMax: 1,
    nativeTools: defaultNativeTools(),
    promptModuleIds: [],
  };
}

function profileToForm(p: AgentProfileRow): AgentFormFields {
  const llm = { ...defaultLlm, ...p.llmConfig } as Record<string, unknown>;
  const beh = { ...defaultBehavior, ...(p.behaviorConfig as object) } as Record<string, unknown>;
  const ntRaw = (beh.nativeTools ?? {}) as Record<string, boolean>;
  const nativeTools = defaultNativeTools();
  for (const k of NATIVE_TOOL_KEYS) {
    if (typeof ntRaw[k] === "boolean") nativeTools[k] = ntRaw[k];
  }
  const inc = (beh.inactivity ?? defaultBehavior.inactivity) as typeof defaultBehavior.inactivity;
  const voice = (beh.voice ?? defaultBehavior.voice) as typeof defaultBehavior.voice;
  const seg = (beh.segmentation ?? defaultBehavior.segmentation) as typeof defaultBehavior.segmentation;
  const ds = (beh.dataSource ?? defaultBehavior.dataSource) as typeof defaultBehavior.dataSource;
  const cr = ds?.connectionRef;
  const preset: "default" | "custom" =
    cr == null || String(cr) === "" || String(cr) === "default" ? "default" : "custom";
  const pm = p.promptModuleIds;
  const promptModuleIds = Array.isArray(pm) ? (pm as string[]).filter((x) => typeof x === "string") : [];
  const prov = String(llm.provider ?? "openai");

  return {
    mode: "edit",
    createBot: false,
    existingBotId: p.botId,
    editBotId: p.botId,
    botName: p.bot.name,
    botDescription: p.bot.description ?? "",
    botIsActive: p.bot.isActive,
    provider: prov,
    model: String(llm.model ?? "gpt-4o-mini"),
    apiBaseUrl: String(llm.apiBaseUrl ?? DEFAULT_API_BASE[prov] ?? ""),
    apiKey: "",
    systemInstructions: String(llm.systemInstructions ?? ""),
    temperature: Number(llm.temperature ?? 0.7),
    maxTokens: Number(llm.maxTokens ?? 1024),
    segmentId: seg.segmentId != null ? String(seg.segmentId) : "",
    entityId: seg.entityId != null ? String(seg.entityId) : "",
    establishmentId: seg.establishmentId != null ? String(seg.establishmentId) : "",
    dataSourcePreset: preset,
    dataSourceRef: cr != null && preset === "custom" ? String(cr) : "",
    voiceEnabled: Boolean(voice.elevenLabsEnabled),
    replyWithAudioOnInboundAudio: Boolean(voice.replyWithAudioOnInboundAudio),
    inactivityEnabled: Boolean(inc.automationEnabled),
    inactivityTimeout: Number(inc.timeoutMinutes ?? 30),
    inactivityFollowUpMax: Number(inc.followUpMax ?? 0),
    nativeTools,
    promptModuleIds,
  };
}

function formToPayload(form: AgentFormFields): {
  llmConfig: Record<string, unknown>;
  behaviorConfig: Record<string, unknown>;
  promptModuleIds: string[];
  botPatch?: { name: string; description: string | null; isActive: boolean };
} {
  const llmConfig: Record<string, unknown> = {
    provider: form.provider,
    model: form.model,
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    apiBaseUrl: form.apiBaseUrl.trim() || null,
    systemInstructions: form.systemInstructions,
  };
  if (form.apiKey.trim()) llmConfig.apiKey = form.apiKey.trim();

  const dataSource =
    form.dataSourcePreset === "default"
      ? { label: "Padrão (Supabase)", connectionRef: "default" }
      : { label: "Custom", connectionRef: form.dataSourceRef.trim() || null };

  const schedulingExternal = form.nativeTools.scheduling_google
    ? "google"
    : form.nativeTools.scheduling_outlook
      ? "outlook"
      : "none";

  const behaviorConfig: Record<string, unknown> = {
    ...defaultBehavior,
    nativeTools: { ...form.nativeTools },
    inactivity: {
      ...defaultBehavior.inactivity,
      automationEnabled: form.inactivityEnabled,
      timeoutMinutes: form.inactivityTimeout,
      followUpMax: form.inactivityEnabled ? Math.max(1, form.inactivityFollowUpMax) : 0,
    },
    voice: {
      elevenLabsEnabled: form.voiceEnabled,
      voiceId: null,
      replyWithAudioOnInboundAudio: form.replyWithAudioOnInboundAudio,
    },
    segmentation: {
      segmentId: form.segmentId.trim() || null,
      entityId: form.entityId.trim() || null,
      establishmentId: form.establishmentId.trim() || null,
    },
    dataSource,
    scheduling: {
      ...defaultBehavior.scheduling,
      externalCalendar: schedulingExternal,
    },
  };

  return {
    llmConfig,
    behaviorConfig,
    promptModuleIds: form.promptModuleIds,
    botPatch:
      form.mode === "edit"
        ? {
            name: form.botName.trim(),
            description: form.botDescription.trim() || null,
            isActive: form.botIsActive,
          }
        : undefined,
  };
}

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

  const [agentProfiles, setAgentProfiles] = useState<AgentProfileRow[]>([]);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentForm, setAgentForm] = useState(emptyAgentForm);

  const loadBots = useCallback(async () => {
    const res = await api.get<{ data: BotRow[] }>("/bots");
    setBots(res.data);
  }, []);

  const loadAgentProfiles = useCallback(async () => {
    const res = await api.get<{ data: AgentProfileRow[] }>("/automation/agent-profiles");
    setAgentProfiles(res.data);
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
      if (tab === "agents") {
        await loadBots();
        await loadAgentProfiles();
        await loadPrompts();
      }
      if (tab === "tools") await loadTools();
      if (tab === "prompts") await loadPrompts();
      if (tab === "interactions") await loadInteractions();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, [tenantAdmin, tab, loadDashboard, loadKnowledge, loadBots, loadAgentProfiles, loadTools, loadPrompts, loadInteractions]);

  useEffect(() => {
    void refreshTab();
  }, [refreshTab]);

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

  const openNewAgentModal = () => {
    setAgentForm(emptyAgentForm());
    setAgentModalOpen(true);
  };

  const openEditAgentModal = (row: AgentProfileRow) => {
    setAgentForm(profileToForm(row));
    setAgentModalOpen(true);
  };

  const openConfigureOrphanBot = (botId: string) => {
    const b = bots.find((x) => x.id === botId);
    setAgentForm({
      ...emptyAgentForm(),
      mode: "new",
      createBot: false,
      existingBotId: botId,
      botName: b?.name ?? "",
      botDescription: b?.description ?? "",
      botIsActive: b?.isActive ?? true,
    });
    setAgentModalOpen(true);
  };

  const saveAgentModal = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = formToPayload(agentForm);
      if (agentForm.mode === "edit" && agentForm.editBotId) {
        await api.put(`/automation/agent-profiles/${agentForm.editBotId}`, {
          llmConfig: payload.llmConfig,
          behaviorConfig: payload.behaviorConfig,
          promptModuleIds: payload.promptModuleIds,
          botPatch: payload.botPatch,
        });
      } else if (agentForm.createBot) {
        if (!agentForm.botName.trim()) {
          setError("validation");
          return;
        }
        await api.post("/automation/agents", {
          createBot: true,
          botName: agentForm.botName.trim(),
          botDescription: agentForm.botDescription.trim() || null,
          botIsActive: agentForm.botIsActive,
          llmConfig: payload.llmConfig,
          behaviorConfig: payload.behaviorConfig,
          promptModuleIds: payload.promptModuleIds,
        });
      } else {
        if (!agentForm.existingBotId) {
          setError("validation");
          return;
        }
        await api.post("/automation/agents", {
          createBot: false,
          botId: agentForm.existingBotId,
          llmConfig: payload.llmConfig,
          behaviorConfig: payload.behaviorConfig,
          promptModuleIds: payload.promptModuleIds,
        });
      }
      setAgentModalOpen(false);
      await loadAgentProfiles();
      await loadBots();
      await loadDashboard();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteAgentProfile = async (botId: string) => {
    if (!window.confirm(t("automationPage.agentDeleteProfileConfirm"))) return;
    setLoading(true);
    try {
      await api.delete(`/automation/agent-profiles/${botId}`);
      await loadAgentProfiles();
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
            {error === "validation" ? t("automationPage.agentValidation") : t("automationPage.loadError")}
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
          <AgentsTab
            t={t}
            loading={loading}
            bots={bots}
            agentProfiles={agentProfiles}
            agentModalOpen={agentModalOpen}
            setAgentModalOpen={setAgentModalOpen}
            agentForm={agentForm}
            setAgentForm={setAgentForm}
            prompts={prompts}
            onNew={openNewAgentModal}
            onEdit={openEditAgentModal}
            onConfigureOrphan={openConfigureOrphanBot}
            onSaveModal={() => void saveAgentModal()}
            onDeleteProfile={deleteAgentProfile}
          />
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

type Translate = (key: string) => string;

function AgentsTab({
  t,
  loading,
  bots,
  agentProfiles,
  agentModalOpen,
  setAgentModalOpen,
  agentForm,
  setAgentForm,
  prompts,
  onNew,
  onEdit,
  onConfigureOrphan,
  onSaveModal,
  onDeleteProfile,
}: {
  t: Translate;
  loading: boolean;
  bots: BotRow[];
  agentProfiles: AgentProfileRow[];
  agentModalOpen: boolean;
  setAgentModalOpen: (v: boolean) => void;
  agentForm: AgentFormFields;
  setAgentForm: Dispatch<SetStateAction<AgentFormFields>>;
  prompts: Array<{ id: string; name: string; slug: string; body: string; version: number }>;
  onNew: () => void;
  onEdit: (row: AgentProfileRow) => void;
  onConfigureOrphan: (botId: string) => void;
  onSaveModal: () => void;
  onDeleteProfile: (botId: string) => void;
}) {
  const profileBotIds = new Set(agentProfiles.map((p) => p.botId));
  const orphanBots = bots.filter((b) => !profileBotIds.has(b.id));

  const toolLabel = (key: NativeToolKey) => t(`automationPage.agentTool_${key}`);

  const onProviderChange = (prov: string) => {
    const models = MODELS_BY_PROVIDER[prov] ?? MODELS_BY_PROVIDER.openai;
    setAgentForm((f) => ({
      ...f,
      provider: prov,
      model: models[0] ?? f.model,
      apiBaseUrl: DEFAULT_API_BASE[prov] ?? f.apiBaseUrl,
    }));
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink-900 dark:text-ink-50">{t("automationPage.agentsHeading")}</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("automationPage.agentsSubheading")}</p>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-500">{t("automationPage.agentHint")}</p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {t("automationPage.agentNewButton")}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {agentProfiles.map((row) => {
          const llm = row.llmConfig as Record<string, unknown>;
          const beh = row.behaviorConfig as Record<string, unknown>;
          const nt = (beh.nativeTools ?? {}) as Record<string, boolean>;
          const seg = (beh.segmentation ?? {}) as Record<string, unknown>;
          const voice = (beh.voice ?? {}) as Record<string, unknown>;
          const model = String(llm.model ?? "—");
          const temp = typeof llm.temperature === "number" ? llm.temperature : Number(llm.temperature ?? 0);
          const maxTok = typeof llm.maxTokens === "number" ? llm.maxTokens : Number(llm.maxTokens ?? 0);
          const instr = String(llm.systemInstructions ?? row.bot.description ?? "");
          const segmentTag = seg.segmentId != null && String(seg.segmentId) ? String(seg.segmentId) : null;

          return (
            <div
              key={row.id}
              className="flex flex-col rounded-xl border border-ink-200 bg-white p-4 shadow-sm dark:border-ink-700 dark:bg-ink-900/60"
            >
              {row.bot.editInExternalAutomation ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                  {t("automationPage.agentExternalWebhookWarning")}
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink-900 dark:text-ink-50">{row.bot.name}</h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{model}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Link
                    to="/bots"
                    className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
                    title={t("automationPage.agentOpenBots")}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
                    title={t("automationPage.agentEdit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProfile(row.botId)}
                    className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                    title={t("automationPage.agentRemoveProfile")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-3 line-clamp-4 text-sm text-ink-700 dark:text-ink-300">{instr || "—"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    row.bot.isActive
                      ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
                      : "bg-ink-200 text-ink-700 dark:bg-ink-700 dark:text-ink-200",
                  )}
                >
                  {row.bot.isActive ? t("automationPage.agentStatusActive") : t("automationPage.agentStatusInactive")}
                </span>
                {segmentTag ? (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                    {segmentTag}
                  </span>
                ) : null}
                {voice.elevenLabsEnabled ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-600 dark:text-ink-400">
                    <Volume2 className="h-3 w-3" /> {t("automationPage.agentVoiceTag")}
                  </span>
                ) : null}
                <span className="text-[11px] text-ink-500">
                  T: {temp.toFixed(2)} · {t("automationPage.agentTokens")}: {maxTok}
                </span>
                {nt.knowledge_search ? (
                  <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[10px] text-ink-600 dark:bg-ink-800 dark:text-ink-400">
                    KB
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {orphanBots.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">{t("automationPage.agentsOrphanTitle")}</h3>
          <ul className="mt-2 space-y-2">
            {orphanBots.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-ink-50/80 px-3 py-2 dark:border-ink-700 dark:bg-ink-900/40"
              >
                <div className="min-w-0">
                  <span className="font-medium text-ink-900 dark:text-ink-100">{b.name}</span>
                  {botExternalWarning(b) ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200">{t("automationPage.agentExternalWebhookWarning")}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onConfigureOrphan(b.id)}
                  className="rounded-lg border border-brand-500 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-950/50"
                >
                  {t("automationPage.agentConfigureAutomation")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {agentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
          <div className="relative w-full max-w-lg rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
              <h3 className="text-lg font-bold text-ink-900 dark:text-ink-50">
                {agentForm.mode === "edit" ? t("automationPage.agentModalEditTitle") : t("automationPage.agentModalNewTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setAgentModalOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-5 py-4">
              {agentForm.mode === "edit" && agentForm.editBotId ? (
                agentProfiles.find((p) => p.botId === agentForm.editBotId)?.bot.editInExternalAutomation ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    {t("automationPage.agentExternalWebhookWarning")}
                  </div>
                ) : null
              ) : null}

              {agentForm.mode === "new" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={agentForm.createBot}
                    onChange={(e) => setAgentForm((f) => ({ ...f, createBot: e.target.checked, existingBotId: e.target.checked ? "" : f.existingBotId }))}
                  />
                  {t("automationPage.agentCreateBotToggle")}
                </label>
              ) : null}

              {agentForm.mode === "new" && !agentForm.createBot ? (
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentSelectExistingBot")}
                  <select
                    value={agentForm.existingBotId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const b = bots.find((x) => x.id === id);
                      setAgentForm((f) => ({
                        ...f,
                        existingBotId: id,
                        botName: b?.name ?? f.botName,
                        botDescription: b?.description ?? f.botDescription,
                        botIsActive: b?.isActive ?? f.botIsActive,
                      }));
                    }}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  >
                    <option value="">{t("automationPage.agentSelectBotPlaceholder")}</option>
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {agentForm.mode === "new" && agentForm.createBot ? (
                <>
                  <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                    {t("automationPage.agentName")}
                    <input
                      value={agentForm.botName}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botName: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </label>
                  <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                    {t("automationPage.agentDescription")}
                    <input
                      value={agentForm.botDescription}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botDescription: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={agentForm.botIsActive}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botIsActive: e.target.checked }))}
                    />
                    {t("automationPage.agentBotActive")}
                  </label>
                </>
              ) : null}

              {agentForm.mode === "edit" ? (
                <>
                  <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                    {t("automationPage.agentName")}
                    <input
                      value={agentForm.botName}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botName: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </label>
                  <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                    {t("automationPage.agentDescription")}
                    <input
                      value={agentForm.botDescription}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botDescription: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={agentForm.botIsActive}
                      onChange={(e) => setAgentForm((f) => ({ ...f, botIsActive: e.target.checked }))}
                    />
                    {t("automationPage.agentBotActive")}
                  </label>
                </>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentProvider")}
                  <select
                    value={agentForm.provider}
                    onChange={(e) => onProviderChange(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  >
                    {PROVIDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentModel")}
                  <select
                    value={agentForm.model}
                    onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  >
                    {(MODELS_BY_PROVIDER[agentForm.provider] ?? MODELS_BY_PROVIDER.openai).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentModelHelp")}</p>
                </label>
              </div>

              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentApiUrl")}
                <input
                  value={agentForm.apiBaseUrl}
                  onChange={(e) => setAgentForm((f) => ({ ...f, apiBaseUrl: e.target.value }))}
                  placeholder={t("automationPage.agentApiUrlPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                />
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentApiUrlHelp")}</p>
              </label>

              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentApiKey")}
                <input
                  type="password"
                  autoComplete="off"
                  value={agentForm.apiKey}
                  onChange={(e) => setAgentForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder={t("automationPage.agentApiKeyPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                />
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentApiKeyHelp")}</p>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentSegment")}
                  <input
                    value={agentForm.segmentId}
                    onChange={(e) => setAgentForm((f) => ({ ...f, segmentId: e.target.value }))}
                    placeholder={t("automationPage.agentSegmentPlaceholder")}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentSegmentHelp")}</p>
                </label>
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentEstablishment")}
                  <input
                    value={agentForm.establishmentId}
                    onChange={(e) => setAgentForm((f) => ({ ...f, establishmentId: e.target.value }))}
                    placeholder={t("automationPage.agentEstablishmentPlaceholder")}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentEstablishmentHelp")}</p>
                </label>
              </div>

              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentEntityId")}
                <input
                  value={agentForm.entityId}
                  onChange={(e) => setAgentForm((f) => ({ ...f, entityId: e.target.value }))}
                  placeholder={t("automationPage.agentEntityPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                />
              </label>

              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentDataSource")}
                <select
                  value={agentForm.dataSourcePreset}
                  onChange={(e) =>
                    setAgentForm((f) => ({
                      ...f,
                      dataSourcePreset: e.target.value as "default" | "custom",
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                >
                  <option value="default">{t("automationPage.agentDataSourceDefault")}</option>
                  <option value="custom">{t("automationPage.agentDataSourceCustom")}</option>
                </select>
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentDataSourceHelp")}</p>
              </label>
              {agentForm.dataSourcePreset === "custom" ? (
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentDataSourceRef")}
                  <input
                    value={agentForm.dataSourceRef}
                    onChange={(e) => setAgentForm((f) => ({ ...f, dataSourceRef: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </label>
              ) : null}

              <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                  <Volume2 className="h-4 w-4 text-brand-600" />
                  {t("automationPage.agentVoiceSection")}
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={agentForm.voiceEnabled}
                    onChange={(e) => setAgentForm((f) => ({ ...f, voiceEnabled: e.target.checked }))}
                  />
                  {t("automationPage.agentVoiceResponses")}
                </label>
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentVoiceHelp")}</p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={agentForm.replyWithAudioOnInboundAudio}
                    onChange={(e) => setAgentForm((f) => ({ ...f, replyWithAudioOnInboundAudio: e.target.checked }))}
                  />
                  {t("automationPage.agentVoiceOnAudioInbound")}
                </label>
              </div>

              <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                  <Clock className="h-4 w-4 text-brand-600" />
                  {t("automationPage.agentInactivitySection")}
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={agentForm.inactivityEnabled}
                    onChange={(e) => setAgentForm((f) => ({ ...f, inactivityEnabled: e.target.checked }))}
                  />
                  {t("automationPage.agentInactivityToggle")}
                </label>
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentInactivityHelp")}</p>
                {agentForm.inactivityEnabled ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                      {t("automationPage.agentInactivityTimeout")}
                      <input
                        type="number"
                        min={1}
                        value={agentForm.inactivityTimeout}
                        onChange={(e) => setAgentForm((f) => ({ ...f, inactivityTimeout: Number(e.target.value) || 30 }))}
                        className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                      />
                    </label>
                    <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                      {t("automationPage.agentInactivityMaxFollowups")}
                      <input
                        type="number"
                        min={1}
                        value={agentForm.inactivityFollowUpMax}
                        onChange={(e) => setAgentForm((f) => ({ ...f, inactivityFollowUpMax: Number(e.target.value) || 1 }))}
                        className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentTemperature")}: {agentForm.temperature.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={agentForm.temperature}
                    onChange={(e) => setAgentForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
                    className="mt-2 w-full accent-brand-600"
                  />
                </label>
                <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                  {t("automationPage.agentMaxTokens")}
                  <input
                    type="number"
                    min={64}
                    max={128000}
                    value={agentForm.maxTokens}
                    onChange={(e) => setAgentForm((f) => ({ ...f, maxTokens: Number(e.target.value) || 1024 }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentSystemInstructions")}
                <textarea
                  value={agentForm.systemInstructions}
                  onChange={(e) => setAgentForm((f) => ({ ...f, systemInstructions: e.target.value }))}
                  rows={5}
                  placeholder={t("automationPage.agentSystemInstructionsPh")}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                />
              </label>

              <div>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-200">{t("automationPage.agentNativeTools")}</p>
                <p className="text-[11px] text-ink-500">{t("automationPage.agentNativeToolsHelp")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {NATIVE_TOOL_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setAgentForm((f) => ({
                          ...f,
                          nativeTools: { ...f.nativeTools, [key]: !f.nativeTools[key] },
                        }))
                      }
                      className={clsx(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        agentForm.nativeTools[key]
                          ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/50 dark:text-brand-200"
                          : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-400",
                      )}
                    >
                      {toolLabel(key)}
                    </button>
                  ))}
                </div>
              </div>

              {prompts.length > 0 ? (
                <fieldset>
                  <legend className="text-sm font-medium text-ink-800 dark:text-ink-200">{t("automationPage.agentPromptModulesPick")}</legend>
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded border border-ink-100 p-2 dark:border-ink-700">
                    {prompts.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={agentForm.promptModuleIds.includes(p.id)}
                          onChange={(e) => {
                            setAgentForm((f) => ({
                              ...f,
                              promptModuleIds: e.target.checked
                                ? [...f.promptModuleIds, p.id]
                                : f.promptModuleIds.filter((id) => id !== p.id),
                            }));
                          }}
                        />
                        {p.name} <span className="opacity-60">({p.slug})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-4 dark:border-ink-800">
              <button
                type="button"
                onClick={() => setAgentModalOpen(false)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium dark:border-ink-600"
              >
                {t("automationPage.agentCancel")}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={onSaveModal}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t("automationPage.agentSaveProfile")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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
