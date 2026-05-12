import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  Sparkles,
  RefreshCw,
  ExternalLink,
  Bot,
  MessageCircle,
  Pencil,
  Trash2,
  X,
  Volume2,
  Clock,
  Blocks,
} from "lucide-react";
import { PageTransition } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { api } from "@/lib/api";
import { AutomationToolsHub } from "@/pages/automation/AutomationToolsHub";
import { AutomationPromptsHub } from "@/pages/automation/AutomationPromptsHub";
import { AutomationKnowledgeHub } from "@/pages/automation/AutomationKnowledgeHub";
import { AutomationExecutionsTab } from "@/pages/automation/AutomationExecutionsTab";
import type { AutomationCustomToolRow, ToolPresetMeta } from "@/pages/automation/automationToolTypes";
import { parsePromptLabels, type PromptModuleRow } from "@/pages/automation/promptHubTypes";
import {
  buildPromptAutoInstructionBlock,
  mergeSystemWithAutoBlock,
  nativeOpenAiToolFunctionName,
  splitStoredSystemInstructions,
} from "@/pages/automation/agentPromptBuilder";

export type { AutomationCustomToolRow } from "@/pages/automation/automationToolTypes";

type Tab =
  | "overview"
  | "knowledge"
  | "agents"
  | "tools"
  | "prompts"
  | "interactions"
  | "executions"
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
  "knowledge_search",
  "list_teams",
  "list_pipeline_stages",
  "assign_team_to_conversation",
  "transfer_to_team",
  "set_conversation_status",
  "list_google_calendars",
  "scheduling_google",
  "scheduling_outlook",
  "call_human",
  "end_conversation",
  "ping",
] as const;

type NativeToolKey = (typeof NATIVE_TOOL_KEYS)[number];

function compactToolConfigPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

const DEFAULT_API_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  google_gemini: "https://generativelanguage.googleapis.com",
};

const PROVIDER_OPTIONS = [
  { value: "openai", labelKey: "automationPage.agentProviderOpenAI" as const },
  { value: "google_gemini", labelKey: "automationPage.agentProviderGemini" as const },
];

/** Valor sintético no `<select>` quando o modelo guardado não está na lista fixa. */
const OPENAI_MODEL_CUSTOM = "__oc_openai_custom_model__";

/** Sugestões alinhadas ao catálogo OpenAI (frontier + chat); «Outro modelo» abre campo de texto. */
const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
  ],
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
  createdAt?: string;
  updatedAt?: string;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
  knowledgeSourceId?: string | null;
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

function defaultConnectedTools(): AgentConnectedToolRow[] {
  return [];
}

function normalizeConnectedTools(raw: unknown): AgentConnectedToolRow[] {
  if (!Array.isArray(raw)) return defaultConnectedTools();
  const out: AgentConnectedToolRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.toolId !== "string") continue;
    out.push({
      toolId: o.toolId,
      enabled: Boolean(o.enabled),
      permission: o.permission === "write" || o.permission === "admin" ? o.permission : "read",
      maxCallsPerConversation:
        typeof o.maxCallsPerConversation === "number"
          ? o.maxCallsPerConversation
          : o.maxCallsPerConversation === null
            ? null
            : null,
      priority: typeof o.priority === "number" ? o.priority : 0,
      runMode: o.runMode === "manual" ? "manual" : "auto",
      agentInstruction: typeof o.agentInstruction === "string" ? o.agentInstruction : undefined,
    });
  }
  return out;
}

const defaultBehavior = {
  nativeTools: defaultNativeTools(),
  escalationRules: {
    conditions: "",
    transferMessage: "",
    mode: "keyword",
    keywords: "",
    transferTeamId: null as string | null,
  },
  inactivity: {
    automationEnabled: false,
    timeoutMinutes: 30,
    followUpMax: 1,
    followUpMessages: [] as string[],
    followUpMessage: "",
    pauseMessage: "",
    closeMessage: "",
    clearContextAfterFollowUpMinutes: null as number | null,
  },
  voice: {
    elevenLabsEnabled: false,
    elevenLabsToolId: null as string | null,
    voiceResponsePercent: 100,
    voiceId: null as string | null,
    replyWithAudioOnInboundAudio: false,
  },
  scheduling: { useOrgReminders: true, externalCalendar: "none" },
  connectedTools: defaultConnectedTools(),
};

export type AgentConnectedToolRow = {
  toolId: string;
  enabled: boolean;
  permission: "read" | "write" | "admin";
  maxCallsPerConversation: number | null;
  priority: number;
  runMode: "auto" | "manual";
  /** Instruções injectadas no bloco automático do prompt para o modelo usar esta ferramenta. */
  agentInstruction?: string;
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
  /** Núcleo editável; ao gravar junta-se o bloco automático de ferramentas / KB. */
  promptUserCore: string;
  /** Artigos da KB referenciados no bloco automático. */
  promptLinkedKnowledgeIds: string[];
  temperature: number;
  maxTokens: number;
  voiceEnabled: boolean;
  elevenLabsToolId: string;
  voiceResponsePercent: number;
  replyWithAudioOnInboundAudio: boolean;
  inactivityEnabled: boolean;
  inactivityTimeout: number;
  inactivityFollowUpMax: number;
  followUpMessage: string;
  escalationMode: string;
  escalationConditions: string;
  escalationTransferMessage: string;
  escalationKeywords: string;
  escalationTeamId: string;
  nativeTools: Record<NativeToolKey, boolean>;
  promptModuleIds: string[];
  connectedTools: AgentConnectedToolRow[];
  /** Instruções por equipa (UUID) para transfer_to_team — guardado em promptBuilder.teamTransferHints. */
  teamTransferHints: Array<{ teamId: string; instruction: string }>;
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
    promptUserCore: "",
    promptLinkedKnowledgeIds: [],
    temperature: 0.7,
    maxTokens: 1024,
    voiceEnabled: false,
    elevenLabsToolId: "",
    voiceResponsePercent: 100,
    replyWithAudioOnInboundAudio: false,
    inactivityEnabled: false,
    inactivityTimeout: 30,
    inactivityFollowUpMax: 1,
    followUpMessage: "",
    escalationMode: "keyword",
    escalationConditions: "",
    escalationTransferMessage: "",
    escalationKeywords: "",
    escalationTeamId: "",
    nativeTools: defaultNativeTools(),
    promptModuleIds: [],
    connectedTools: defaultConnectedTools(),
    teamTransferHints: [],
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
  const esc = (beh.escalationRules ?? defaultBehavior.escalationRules) as typeof defaultBehavior.escalationRules;
  const pm = p.promptModuleIds;
  const promptModuleIds = Array.isArray(pm) ? (pm as string[]).filter((x) => typeof x === "string") : [];
  const prov = String(llm.provider ?? "openai");

  const pbRaw = beh.promptBuilder;
  const pb = pbRaw && typeof pbRaw === "object" ? (pbRaw as Record<string, unknown>) : {};
  const linkedRaw = pb.linkedKnowledgeArticleIds;
  const promptLinkedKnowledgeIds = Array.isArray(linkedRaw)
    ? linkedRaw.filter((x): x is string => typeof x === "string" && x.length >= 32)
    : [];
  const hintsRaw = pb.teamTransferHints;
  const teamTransferHints: Array<{ teamId: string; instruction: string }> = Array.isArray(hintsRaw)
    ? hintsRaw
        .map((x) => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const teamId = typeof o.teamId === "string" ? o.teamId.trim() : "";
          const instruction = typeof o.instruction === "string" ? o.instruction : "";
          if (!teamId) return null;
          return { teamId, instruction };
        })
        .filter((x): x is { teamId: string; instruction: string } => x != null)
    : [];
  const userFromPb = typeof pb.userCore === "string" ? pb.userCore : null;
  const fullInstr = String(llm.systemInstructions ?? "");
  const strippedCore = splitStoredSystemInstructions(fullInstr).userCore;
  const promptUserCore = userFromPb != null ? userFromPb : strippedCore;

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
    apiKey: typeof llm.apiKey === "string" ? llm.apiKey : "",
    promptUserCore,
    promptLinkedKnowledgeIds,
    temperature: Number(llm.temperature ?? 0.7),
    maxTokens: Number(llm.maxTokens ?? 1024),
    voiceEnabled: Boolean(voice.elevenLabsEnabled),
    elevenLabsToolId: voice.elevenLabsToolId != null ? String(voice.elevenLabsToolId) : "",
    voiceResponsePercent: Math.min(
      100,
      Math.max(0, Number(voice.voiceResponsePercent ?? 100)),
    ),
    replyWithAudioOnInboundAudio: Boolean(voice.replyWithAudioOnInboundAudio),
    inactivityEnabled: Boolean(inc.automationEnabled),
    inactivityTimeout: Number(inc.timeoutMinutes ?? 30),
    inactivityFollowUpMax: Number(inc.followUpMax ?? 0),
    followUpMessage: String(
      inc.followUpMessage ?? (Array.isArray(inc.followUpMessages) ? inc.followUpMessages[0] ?? "" : ""),
    ),
    escalationMode: String(esc.mode ?? "keyword"),
    escalationConditions: String(esc.conditions ?? ""),
    escalationTransferMessage: String(esc.transferMessage ?? ""),
    escalationKeywords: String(esc.keywords ?? ""),
    escalationTeamId: (() => {
      const raw = (esc as Record<string, unknown>).transferTeamId;
      return typeof raw === "string" ? raw : "";
    })(),
    nativeTools,
    promptModuleIds,
    connectedTools: normalizeConnectedTools(beh.connectedTools),
    teamTransferHints,
  };
}

function formToPayload(
  form: AgentFormFields,
  ctx: {
    knowledgeArticles: KnowledgeArticle[];
    customTools: AutomationCustomToolRow[];
    orgTeams: Array<{ id: string; name: string }>;
    t: (key: string) => string;
  },
): {
  llmConfig: Record<string, unknown>;
  behaviorConfig: Record<string, unknown>;
  promptModuleIds: string[];
  botPatch?: { name: string; description: string | null; isActive: boolean };
} {
  const linkedTitles = form.promptLinkedKnowledgeIds
    .map((id) => ctx.knowledgeArticles.find((a) => a.id === id)?.title)
    .filter((x): x is string => Boolean(x));
  const connectedNames = form.connectedTools
    .filter((x) => x.enabled)
    .map((x) => ctx.customTools.find((tl) => tl.id === x.toolId)?.name)
    .filter((x): x is string => Boolean(x));
  const connectedInstructions = form.connectedTools
    .filter((x) => x.enabled)
    .map((x) => {
      const tl = ctx.customTools.find((c) => c.id === x.toolId);
      const name = tl?.name;
      const ins = (x.agentInstruction ?? "").trim();
      if (!name || !ins) return null;
      return { name, instruction: ins, toolId: x.toolId };
    })
    .filter((x): x is { name: string; instruction: string; toolId: string } => x != null);
  const teamHintsResolved = form.teamTransferHints
    .filter((h) => h.instruction.trim())
    .map((h) => ({
      teamId: h.teamId,
      teamName: ctx.orgTeams.find((o) => o.id === h.teamId)?.name ?? h.teamId,
      instruction: h.instruction.trim(),
    }));
  const escTeamId = form.escalationTeamId.trim();
  const escTeamName = escTeamId ? (ctx.orgTeams.find((o) => o.id === escTeamId)?.name ?? null) : null;
  const hasEsc =
    Boolean(escTeamId) ||
    Boolean(form.escalationKeywords.trim()) ||
    Boolean(form.escalationConditions.trim()) ||
    Boolean(form.escalationTransferMessage.trim());
  const autoInner = buildPromptAutoInstructionBlock({
    nativeTools: form.nativeTools as Record<string, boolean>,
    linkedArticleTitles: linkedTitles,
    connectedToolNames: connectedNames,
    connectedToolInstructions: connectedInstructions,
    teamTransferHints: teamHintsResolved,
    escalation: hasEsc
      ? {
          mode: form.escalationMode,
          targetTeamId: escTeamId || null,
          targetTeamName: escTeamName,
          keywords: form.escalationKeywords,
          conditions: form.escalationConditions,
          transferMessage: form.escalationTransferMessage,
        }
      : null,
    t: ctx.t,
  });
  const mergedInstructions = mergeSystemWithAutoBlock(form.promptUserCore, autoInner);

  const modelResolved =
    form.model.trim() ||
    (form.provider === "google_gemini" ? (MODELS_BY_PROVIDER.google_gemini[0] ?? "gemini-2.0-flash") : "gpt-4o-mini");

  const llmConfig: Record<string, unknown> = {
    provider: form.provider,
    model: modelResolved,
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    apiBaseUrl: form.apiBaseUrl.trim() || null,
    systemInstructions: mergedInstructions,
  };
  const apiKeyTrimmed = form.apiKey.trim();
  // Evitar enviar o placeholder "***" (o backend interpreta como “não mudou”).
  if (apiKeyTrimmed && apiKeyTrimmed !== "***") llmConfig.apiKey = apiKeyTrimmed;

  const schedulingExternal = form.nativeTools.scheduling_google
    ? "google"
    : form.nativeTools.scheduling_outlook
      ? "outlook"
      : "none";

  const fu = form.followUpMessage.trim();
  const behaviorConfig: Record<string, unknown> = {
    ...defaultBehavior,
    nativeTools: { ...form.nativeTools },
    connectedTools: form.connectedTools,
    escalationRules: {
      ...defaultBehavior.escalationRules,
      mode: form.escalationMode,
      conditions: form.escalationConditions,
      transferMessage: form.escalationTransferMessage,
      keywords: form.escalationKeywords,
      transferTeamId: escTeamId || null,
    },
    inactivity: {
      ...defaultBehavior.inactivity,
      automationEnabled: form.inactivityEnabled,
      timeoutMinutes: form.inactivityTimeout,
      followUpMax: form.inactivityEnabled ? Math.max(1, form.inactivityFollowUpMax) : 0,
      followUpMessage: fu,
      followUpMessages: fu ? [fu] : [],
    },
    voice: {
      elevenLabsEnabled: form.voiceEnabled,
      elevenLabsToolId: form.elevenLabsToolId.trim() || null,
      voiceResponsePercent: Math.min(100, Math.max(0, form.voiceResponsePercent)),
      voiceId: null,
      replyWithAudioOnInboundAudio: form.replyWithAudioOnInboundAudio,
    },
    scheduling: {
      ...defaultBehavior.scheduling,
      externalCalendar: schedulingExternal,
    },
    promptBuilder: {
      userCore: form.promptUserCore,
      linkedKnowledgeArticleIds: form.promptLinkedKnowledgeIds,
      teamTransferHints: form.teamTransferHints.filter((h) => h.instruction.trim()),
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

/** Combine selected prompt modules into agent LLM fields, system instructions, and tool links. */
function applyPromptModuleSelectionToAgentForm(
  f: AgentFormFields,
  nextPromptModuleIds: string[],
  promptsList: PromptModuleRow[],
): AgentFormFields {
  const ordered = nextPromptModuleIds
    .map((id) => promptsList.find((pm) => pm.id === id))
    .filter((pm): pm is PromptModuleRow => pm != null);
  const bodies = ordered.map((pm) => pm.body.trim()).filter(Boolean);
  const promptUserCore = ordered.length > 0 ? bodies.join("\n\n---\n\n") : f.promptUserCore;

  const toolIdSet = new Set<string>();
  for (const pm of ordered) {
    const lb = parsePromptLabels(pm.labels);
    for (const tid of lb.connectedToolIds ?? []) {
      if (tid) toolIdSet.add(tid);
    }
  }

  let connectedTools = f.connectedTools;
  for (const tid of toolIdSet) {
    const existing = connectedTools.find((x) => x.toolId === tid);
    if (existing) {
      connectedTools = connectedTools.map((x) => (x.toolId === tid ? { ...x, enabled: true } : x));
    } else {
      connectedTools = [
        ...connectedTools,
        {
          toolId: tid,
          enabled: true,
          permission: "read" as const,
          maxCallsPerConversation: null,
          priority: 0,
          runMode: "auto" as const,
          agentInstruction: undefined,
        },
      ];
    }
  }

  let next: AgentFormFields = {
    ...f,
    promptModuleIds: nextPromptModuleIds,
    promptUserCore,
    connectedTools,
  };

  const firstLlm = ordered.map((pm) => parsePromptLabels(pm.labels).llmDefaults).find(Boolean);
  if (firstLlm && ordered.length > 0) {
    next = {
      ...next,
      provider: firstLlm.provider,
      model: firstLlm.model,
      temperature: firstLlm.temperature,
      maxTokens: firstLlm.maxTokens,
      apiBaseUrl:
        firstLlm.provider === "openai"
          ? firstLlm.apiBaseUrl?.trim() || DEFAULT_API_BASE.openai
          : DEFAULT_API_BASE.google_gemini,
    };
  }

  return next;
}

export function AutomationPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [prompts, setPrompts] = useState<PromptModuleRow[]>([]);
  const [tools, setTools] = useState<AutomationCustomToolRow[]>([]);
  const [toolPresets, setToolPresets] = useState<ToolPresetMeta[]>([]);
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

  const [agentProfiles, setAgentProfiles] = useState<AgentProfileRow[]>([]);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentForm, setAgentForm] = useState(emptyAgentForm);
  const [orgTeamsForAgent, setOrgTeamsForAgent] = useState<Array<{ id: string; name: string }>>([]);

  const [ctxRows, setCtxRows] = useState<
    Array<{
      conversationId: string;
      botId: string;
      botName: string;
      updatedAt: string;
      lastClearedAt: string | null;
    }>
  >([]);
  const [ctxManualId, setCtxManualId] = useState("");
  const [ctxView, setCtxView] = useState<unknown>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);

  useEffect(() => {
    if (!agentModalOpen) return;
    let cancelled = false;
    void api
      .get<{ data: { id: string; name: string }[] }>("/teams")
      .then((res) => {
        if (!cancelled) setOrgTeamsForAgent(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setOrgTeamsForAgent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agentModalOpen]);

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
    const res = await api.get<{ data: PromptModuleRow[] }>("/automation/prompt-modules");
    setPrompts(res.data);
  }, []);

  const loadTools = useCallback(async () => {
    const res = await api.get<{ data: AutomationCustomToolRow[] }>("/automation/custom-tools");
    setTools(res.data);
  }, []);

  const loadToolPresets = useCallback(async () => {
    const res = await api.get<{ data: ToolPresetMeta[] }>("/automation/tool-presets");
    setToolPresets(res.data);
  }, []);

  const loadInteractions = useCallback(async () => {
    const res = await api.get<{ data: typeof interactions }>("/automation/interactions");
    setInteractions(res.data);
  }, []);

  const loadContextRows = useCallback(async () => {
    const res = await api.get<{
      data: Array<{
        conversationId: string;
        botId: string;
        botName: string;
        updatedAt: string;
        lastClearedAt: string | null;
      }>;
    }>("/automation/conversation-context");
    setCtxRows(res.data);
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
        await loadTools();
        await loadKnowledge();
      }
      if (tab === "tools") {
        await loadTools();
        await loadToolPresets();
        await loadBots();
      }
      if (tab === "prompts") {
        await loadPrompts();
        await loadTools();
      }
      if (tab === "interactions") await loadInteractions();
      if (tab === "executions") await loadBots();
      if (tab === "context") await loadContextRows();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, [
    tenantAdmin,
    tab,
    loadDashboard,
    loadKnowledge,
    loadBots,
    loadAgentProfiles,
    loadTools,
    loadToolPresets,
    loadPrompts,
    loadKnowledge,
    loadInteractions,
    loadContextRows,
  ]);

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

  const openNewAgentModal = () => {
    setAgentForm(emptyAgentForm());
    setAgentModalOpen(true);
  };

  const openAgentFromPromptModule = useCallback((row: PromptModuleRow) => {
    const base = emptyAgentForm();
    const merged = applyPromptModuleSelectionToAgentForm(base, [row.id], [row]);
    const lb = parsePromptLabels(row.labels);
    setAgentForm({
      ...merged,
      mode: "new",
      createBot: true,
      botName: row.name.slice(0, 120),
      botDescription: (lb.description ?? "").trim().slice(0, 500),
      botIsActive: true,
      existingBotId: "",
      editBotId: null,
    });
    setTab("agents");
    setAgentModalOpen(true);
  }, []);

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
      const payload = formToPayload(agentForm, {
        knowledgeArticles: articles,
        customTools: tools,
        orgTeams: orgTeamsForAgent,
        t,
      });
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

  const installToolPreset = async (presetKey: string) => {
    setLoading(true);
    setError("");
    try {
      await api.post("/automation/custom-tools/from-preset", { presetKey });
      await loadTools();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const saveToolConfigPatch = async (toolId: string, patch: Record<string, unknown>) => {
    const cleaned = compactToolConfigPatch(patch);
    if (Object.keys(cleaned).length === 0) return;
    setLoading(true);
    setError("");
    try {
      await api.patch(`/automation/custom-tools/${toolId}`, { config: cleaned });
      await loadTools();
      setEditingToolId(null);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const patchAutomationTool = async (toolId: string, patch: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    try {
      await api.patch(`/automation/custom-tools/${toolId}`, patch);
      await loadTools();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteCustomToolRow = async (toolId: string) => {
    if (!window.confirm(t("automationPage.toolDeleteConfirm"))) return;
    setLoading(true);
    try {
      await api.delete(`/automation/custom-tools/${toolId}`);
      await loadTools();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadContextDetail = async (conversationId: string) => {
    const id = conversationId.trim();
    if (!id) return;
    setError("");
    try {
      const row = await api.get<Record<string, unknown>>(`/automation/conversation-context/${id}`);
      setCtxView(row);
      setCtxManualId(id);
    } catch {
      setCtxView(null);
      setError("load_failed");
    }
  };

  const clearContextForConversation = async (conversationId: string) => {
    const id = conversationId.trim();
    if (!id) return;
    if (!window.confirm(t("automationPage.contextClearConfirm"))) return;
    setLoading(true);
    setError("");
    try {
      await api.post(`/automation/conversation-context/${id}/clear`, {});
      await loadContextRows();
      setCtxView(null);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const presetInstalled = (presetKey: string) =>
    tools.some((x) => (x.config as Record<string, unknown> | undefined)?.presetKey === presetKey);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: t("automationPage.tabOverview") },
    { id: "knowledge", label: t("automationPage.tabKnowledge") },
    { id: "agents", label: t("automationPage.tabAgents") },
    { id: "tools", label: t("automationPage.tabTools") },
    { id: "prompts", label: t("automationPage.tabPrompts") },
    { id: "interactions", label: t("automationPage.tabInteractions") },
    { id: "executions", label: t("automationPage.tabExecutions") },
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
            {error === "validation"
              ? t("automationPage.agentValidation")
              : error === "prompt_validation"
                ? t("automationPage.promptValidation")
                : error === "load_failed"
                  ? t("automationPage.loadError")
                  : error}
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
          <AutomationKnowledgeHub
            t={t}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            bots={bots}
            articles={articles}
            onRefresh={loadKnowledge}
          />
        ) : null}

        {tab === "agents" ? (
          <AgentsTab
            t={t}
            loading={loading}
            bots={bots}
            tools={tools}
            articles={articles}
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
            onOpenToolsTab={() => {
              setAgentModalOpen(false);
              setTab("tools");
            }}
            applyPromptModulesSelection={(nextIds) =>
              setAgentForm((f) => applyPromptModuleSelectionToAgentForm(f, nextIds, prompts))
            }
            onOpenKnowledgeTab={() => {
              setAgentModalOpen(false);
              setTab("knowledge");
            }}
            orgTeams={orgTeamsForAgent}
            suggestionLocale={locale}
          />
        ) : null}

        {tab === "executions" ? (
          <AutomationExecutionsTab
            t={t}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            bots={bots}
          />
        ) : null}

        {tab === "prompts" ? (
          <AutomationPromptsHub
            t={t}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            prompts={prompts}
            tools={tools}
            agentProfiles={agentProfiles}
            userDisplayName={user?.name ?? null}
            onRefresh={async () => {
              await loadPrompts();
            }}
            onNavigateAgents={() => setTab("agents")}
            onOpenToolsTab={() => setTab("tools")}
            onCreateAgentFromPrompt={openAgentFromPromptModule}
          />
        ) : null}

        {tab === "tools" ? (
          <AutomationToolsHub
            t={t}
            loading={loading}
            tools={tools}
            toolPresets={toolPresets}
            installToolPreset={(k) => installToolPreset(k)}
            presetInstalled={presetInstalled}
            deleteCustomToolRow={(id) => deleteCustomToolRow(id)}
            saveToolConfigPatch={(id, p) => saveToolConfigPatch(id, p)}
            patchTool={(id, p) => patchAutomationTool(id, p)}
            editingToolId={editingToolId}
            setEditingToolId={setEditingToolId}
            CredentialEditor={ToolCredentialEditor}
            onToolsUpdated={loadTools}
          />
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
          <div className="max-w-3xl space-y-6 text-sm text-ink-700 dark:text-ink-300">
            <p>{t("automationPage.contextBlurb")}</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={ctxManualId}
                onChange={(e) => setCtxManualId(e.target.value)}
                placeholder={t("automationPage.contextConversationPlaceholder")}
                className="min-w-[240px] flex-1 rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadContextDetail(ctxManualId)}
                className="rounded-lg border border-ink-200 px-4 py-2 font-medium dark:border-ink-600"
              >
                {t("automationPage.contextLoad")}
              </button>
              <button
                type="button"
                disabled={loading || !ctxManualId.trim()}
                onClick={() => void clearContextForConversation(ctxManualId)}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {t("automationPage.contextClear")}
              </button>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.contextRecent")}</h3>
              {ctxRows.length === 0 ? (
                <p className="mt-2 text-xs text-ink-500">{t("automationPage.contextEmpty")}</p>
              ) : (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-ink-200 dark:border-ink-700">
                  {ctxRows.map((r) => (
                    <li
                      key={r.conversationId}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2 text-xs dark:border-ink-800"
                    >
                      <div className="min-w-0">
                        <code className="break-all text-ink-800 dark:text-ink-200">{r.conversationId}</code>
                        <div className="text-ink-500">
                          {r.botName} · {new Date(r.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="font-medium text-brand-600"
                          onClick={() => void loadContextDetail(r.conversationId)}
                        >
                          {t("automationPage.contextLoad")}
                        </button>
                        <button
                          type="button"
                          className="font-medium text-red-600"
                          onClick={() => void clearContextForConversation(r.conversationId)}
                        >
                          {t("automationPage.contextClear")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {ctxView ? (
              <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-950/50">
                <p className="text-xs font-semibold text-ink-500">{t("automationPage.contextSnapshot")}</p>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-800 dark:text-ink-200">
                  {JSON.stringify(ctxView, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}

type Translate = (key: string) => string;

const VOICE_PERCENT_STEPS = [0, 10, 20, 30, 50, 75, 100] as const;

type AgentTestChatTurn = { role: "user" | "assistant"; content: string };

function AgentsTab({
  t,
  loading,
  bots,
  tools,
  articles,
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
  onOpenToolsTab,
  applyPromptModulesSelection,
  onOpenKnowledgeTab,
  orgTeams,
  suggestionLocale,
}: {
  t: Translate;
  loading: boolean;
  bots: BotRow[];
  tools: AutomationCustomToolRow[];
  articles: KnowledgeArticle[];
  agentProfiles: AgentProfileRow[];
  agentModalOpen: boolean;
  setAgentModalOpen: (v: boolean) => void;
  agentForm: AgentFormFields;
  setAgentForm: Dispatch<SetStateAction<AgentFormFields>>;
  prompts: PromptModuleRow[];
  onNew: () => void;
  onEdit: (row: AgentProfileRow) => void;
  onConfigureOrphan: (botId: string) => void;
  onSaveModal: () => void;
  onDeleteProfile: (botId: string) => void;
  onOpenToolsTab: () => void;
  applyPromptModulesSelection: (nextPromptModuleIds: string[]) => void;
  onOpenKnowledgeTab: () => void;
  orgTeams: Array<{ id: string; name: string }>;
  suggestionLocale: string;
}) {
  const profileBotIds = new Set(agentProfiles.map((p) => p.botId));
  const orphanBots = bots.filter((b) => !profileBotIds.has(b.id));
  const [testChatBot, setTestChatBot] = useState<{ id: string; name: string } | null>(null);
  const [testChatDraft, setTestChatDraft] = useState("");
  const [testChatTurns, setTestChatTurns] = useState<AgentTestChatTurn[]>([]);
  const [testChatBusy, setTestChatBusy] = useState(false);
  const elevenLabsTools = tools.filter((x) => x.toolType === "ELEVENLABS");
  const [promptEditorTab, setPromptEditorTab] = useState<"builder" | "merged">("builder");
  const [kbArticleFilter, setKbArticleFilter] = useState("");
  const [instructionSuggestBusy, setInstructionSuggestBusy] = useState<string | null>(null);
  const suggestLocaleApi = suggestionLocale === "en" ? "en" : "pt-BR";

  useEffect(() => {
    if (!agentModalOpen) {
      setPromptEditorTab("builder");
      setKbArticleFilter("");
    }
  }, [agentModalOpen]);

  useEffect(() => {
    if (!agentModalOpen) return;
    if (elevenLabsTools.length > 0) return;
    setAgentForm((f) => {
      if (!f.voiceEnabled && !f.elevenLabsToolId && !f.replyWithAudioOnInboundAudio) return f;
      return {
        ...f,
        voiceEnabled: false,
        elevenLabsToolId: "",
        replyWithAudioOnInboundAudio: false,
      };
    });
  }, [agentModalOpen, elevenLabsTools.length, setAgentForm]);

  const openAgentTestChat = (botId: string, botName: string) => {
    setTestChatBot({ id: botId, name: botName });
    setTestChatDraft("");
    setTestChatTurns([]);
    setTestChatBusy(false);
  };

  const sendAgentTestChat = async () => {
    if (!testChatBot) return;
    const userMessage = testChatDraft.trim();
    if (!userMessage || testChatBusy) return;
    const nextTurns: AgentTestChatTurn[] = [...testChatTurns, { role: "user", content: userMessage }];
    setTestChatTurns(nextTurns);
    setTestChatDraft("");
    setTestChatBusy(true);
    try {
      const res = await api.post<{ assistantMessage: string }>(
        `/automation/agent-profiles/${testChatBot.id}/test-chat`,
        {
          message: userMessage,
          history: nextTurns.slice(0, -1),
        },
      );
      const assistant = (res.assistantMessage ?? "").trim() || "Sem resposta.";
      setTestChatTurns((prev) => [...prev, { role: "assistant", content: assistant }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao testar agente";
      setTestChatTurns((prev) => [...prev, { role: "assistant", content: `Erro: ${msg}` }]);
    } finally {
      setTestChatBusy(false);
    }
  };

  const toolLabel = (key: NativeToolKey) => t(`automationPage.agentTool_${key}`);

  const promptAutoPreview = useMemo(() => {
    const linkedTitles = agentForm.promptLinkedKnowledgeIds
      .map((id) => articles.find((a) => a.id === id)?.title)
      .filter((x): x is string => Boolean(x));
    const connectedNames = agentForm.connectedTools
      .filter((c) => c.enabled)
      .map((c) => tools.find((tl) => tl.id === c.toolId)?.name)
      .filter((x): x is string => Boolean(x));
    const connectedInstructions = agentForm.connectedTools
      .filter((x) => x.enabled)
      .map((x) => {
        const tl = tools.find((c) => c.id === x.toolId);
        const name = tl?.name;
        const ins = (x.agentInstruction ?? "").trim();
        if (!name || !ins) return null;
        return { name, instruction: ins, toolId: x.toolId };
      })
      .filter((x): x is { name: string; instruction: string; toolId: string } => x != null);
    const teamHintsResolved = agentForm.teamTransferHints
      .filter((h) => h.instruction.trim())
      .map((h) => ({
        teamId: h.teamId,
        teamName: orgTeams.find((o) => o.id === h.teamId)?.name ?? h.teamId,
        instruction: h.instruction.trim(),
      }));
    const escTeamId = agentForm.escalationTeamId.trim();
    const escTeamName = escTeamId ? (orgTeams.find((o) => o.id === escTeamId)?.name ?? null) : null;
    const hasEsc =
      Boolean(escTeamId) ||
      Boolean(agentForm.escalationKeywords.trim()) ||
      Boolean(agentForm.escalationConditions.trim()) ||
      Boolean(agentForm.escalationTransferMessage.trim());
    return buildPromptAutoInstructionBlock({
      nativeTools: agentForm.nativeTools as Record<string, boolean>,
      linkedArticleTitles: linkedTitles,
      connectedToolNames: connectedNames,
      connectedToolInstructions: connectedInstructions,
      teamTransferHints: teamHintsResolved,
      escalation: hasEsc
        ? {
            mode: agentForm.escalationMode,
            targetTeamId: escTeamId || null,
            targetTeamName: escTeamName,
            keywords: agentForm.escalationKeywords,
            conditions: agentForm.escalationConditions,
            transferMessage: agentForm.escalationTransferMessage,
          }
        : null,
      t,
    });
  }, [
    agentForm.connectedTools,
    agentForm.escalationConditions,
    agentForm.escalationKeywords,
    agentForm.escalationMode,
    agentForm.escalationTeamId,
    agentForm.escalationTransferMessage,
    agentForm.nativeTools,
    agentForm.promptLinkedKnowledgeIds,
    agentForm.teamTransferHints,
    articles,
    orgTeams,
    tools,
    t,
  ]);

  const mergedPromptPreview = useMemo(
    () => mergeSystemWithAutoBlock(agentForm.promptUserCore, promptAutoPreview),
    [agentForm.promptUserCore, promptAutoPreview],
  );

  const runSuggestInstruction = useCallback(
    async (busyKey: string, body: Record<string, unknown>): Promise<string> => {
      setInstructionSuggestBusy(busyKey);
      try {
        const res = await api.post<{ instruction: string }>("/automation/prompt-builder/suggest-instruction", {
          locale: suggestLocaleApi,
          ...body,
        });
        return (res.instruction ?? "").trim();
      } finally {
        setInstructionSuggestBusy(null);
      }
    },
    [suggestLocaleApi],
  );

  const canTeamTransferHints =
    agentForm.nativeTools.list_teams === true ||
    agentForm.nativeTools.assign_team_to_conversation === true ||
    agentForm.nativeTools.transfer_to_team === true;

  const kbScopeBotId =
    agentForm.editBotId ||
    (agentForm.mode === "new" && !agentForm.createBot && agentForm.existingBotId.trim()
      ? agentForm.existingBotId.trim()
      : null);

  const kbLinkedArticleCount = useMemo(() => {
    if (!kbScopeBotId) return null;
    return articles.filter(
      (a) =>
        a.syncToAi !== false &&
        a.isActive !== false &&
        Array.isArray(a.botIds) &&
        a.botIds.includes(kbScopeBotId),
    ).length;
  }, [articles, kbScopeBotId]);

  const orgKbActiveSyncCount = useMemo(
    () => articles.filter((a) => a.syncToAi !== false && a.isActive !== false).length,
    [articles],
  );

  const kbq = kbArticleFilter.trim().toLowerCase();
  const visibleKbArticles = articles.filter((a) => {
    if (kbq && !(`${a.title} ${a.content ?? ""}`.toLowerCase().includes(kbq))) return false;
    if (
      agentForm.editBotId &&
      Array.isArray(a.botIds) &&
      a.botIds.length > 0 &&
      !a.botIds.includes(agentForm.editBotId)
    ) {
      return false;
    }
    return a.isActive !== false;
  });

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
          const voice = (beh.voice ?? {}) as Record<string, unknown>;
          const model = String(llm.model ?? "—");
          const temp = typeof llm.temperature === "number" ? llm.temperature : Number(llm.temperature ?? 0);
          const maxTok = typeof llm.maxTokens === "number" ? llm.maxTokens : Number(llm.maxTokens ?? 0);
          const instr = String(llm.systemInstructions ?? row.bot.description ?? "");
          const linkedKbCount = articles.filter(
            (a) =>
              a.syncToAi !== false &&
              a.isActive !== false &&
              Array.isArray(a.botIds) &&
              a.botIds.includes(row.bot.id),
          ).length;

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
                  <button
                    type="button"
                    onClick={() => openAgentTestChat(row.bot.id, row.bot.name)}
                    className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
                    title={t("automationPage.agentTestChat")}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                  <Link
                    to="/bots"
                    className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
                    title={t("automationPage.agentOpenBots")}
                  >
                    <Bot className="h-4 w-4" />
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
                {voice.elevenLabsEnabled ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-600 dark:text-ink-400">
                    <Volume2 className="h-3 w-3" /> {t("automationPage.agentVoiceTag")}
                  </span>
                ) : null}
                <span className="text-[11px] text-ink-500">
                  T: {temp.toFixed(2)} · {t("automationPage.agentTokens")}: {maxTok}
                </span>
                {!nt.knowledge_search ? (
                  <span
                    className="rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
                    title={t("automationPage.agentKbBadgeToolOffTitle")}
                  >
                    {t("automationPage.agentKbBadgeToolOff")}
                  </span>
                ) : orgKbActiveSyncCount === 0 ? (
                  <span
                    className="rounded-full border border-red-300/80 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                    title={t("automationPage.agentKbBadgeEmptyTitle")}
                  >
                    {t("automationPage.agentKbBadgeEmpty")}
                  </span>
                ) : linkedKbCount > 0 ? (
                  <span
                    className="rounded-full border border-emerald-300/80 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                    title={t("automationPage.agentKbBadgeLinkedTitle").replace("{count}", String(linkedKbCount))}
                  >
                    {t("automationPage.agentKbBadgeLinked").replace("{count}", String(linkedKbCount))}
                  </span>
                ) : (
                  <span
                    className="rounded-full border border-sky-300/80 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-950 dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-100"
                    title={t("automationPage.agentKbBadgeOrgTitle").replace("{count}", String(orgKbActiveSyncCount))}
                  >
                    {t("automationPage.agentKbBadgeOrg").replace("{count}", String(orgKbActiveSyncCount))}
                  </span>
                )}
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

      {testChatBot ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 py-10">
          <div className="w-full max-w-xl rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("automationPage.agentTestChat")}</h3>
                <p className="text-xs text-ink-500 dark:text-ink-400">{testChatBot.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setTestChatBot(null)}
                className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
              {testChatTurns.length === 0 ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{t("automationPage.agentTestChatHint")}</p>
              ) : (
                testChatTurns.map((turn, idx) => (
                  <div
                    key={`${turn.role}-${idx}`}
                    className={clsx(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      turn.role === "user"
                        ? "ml-auto bg-brand-600 text-white"
                        : "bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-ink-100",
                    )}
                  >
                    {turn.content}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-ink-100 px-5 py-4 dark:border-ink-800">
              <input
                value={testChatDraft}
                onChange={(e) => setTestChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendAgentTestChat();
                  }
                }}
                placeholder={t("automationPage.agentTestChatInput")}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
              />
              <button
                type="button"
                disabled={!testChatDraft.trim() || testChatBusy}
                onClick={() => void sendAgentTestChat()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {testChatBusy ? t("common.loading") : t("automationPage.agentTestChatSend")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {agentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-4 sm:p-5">
          <div className="relative flex max-h-[min(92vh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
            <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
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

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4">
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
                  {agentForm.provider === "openai" ? (
                    <>
                      <select
                        value={
                          MODELS_BY_PROVIDER.openai.includes(agentForm.model)
                            ? agentForm.model
                            : OPENAI_MODEL_CUSTOM
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === OPENAI_MODEL_CUSTOM) {
                            setAgentForm((f) => ({
                              ...f,
                              model: MODELS_BY_PROVIDER.openai.includes(f.model) ? "" : f.model,
                            }));
                          } else {
                            setAgentForm((f) => ({ ...f, model: v }));
                          }
                        }}
                        className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                      >
                        {MODELS_BY_PROVIDER.openai.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        <option value={OPENAI_MODEL_CUSTOM}>{t("automationPage.agentModelCustom")}</option>
                      </select>
                      {!MODELS_BY_PROVIDER.openai.includes(agentForm.model) ? (
                        <input
                          type="text"
                          value={agentForm.model}
                          onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                          placeholder={t("automationPage.agentModelCustomPlaceholder")}
                          maxLength={120}
                          autoComplete="off"
                          className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                        />
                      ) : null}
                    </>
                  ) : (
                    <select
                      value={agentForm.model}
                      onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    >
                      {(MODELS_BY_PROVIDER[agentForm.provider] ?? MODELS_BY_PROVIDER.google_gemini).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
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
                {agentForm.apiKey === "***" ? (
                  <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                    Chave já configurada. Digite uma nova para substituir.
                  </p>
                ) : null}
              </label>

              {elevenLabsTools.length > 0 ? (
                <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                    <Volume2 className="h-4 w-4 text-brand-600" />
                    {t("automationPage.agentVoiceSection")}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      checked={agentForm.voiceEnabled}
                      onChange={(e) => setAgentForm((f) => ({ ...f, voiceEnabled: e.target.checked }))}
                    />
                    <span>{t("automationPage.agentVoiceResponses")}</span>
                  </label>
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentVoiceHelp")}</p>
                  {agentForm.voiceEnabled ? (
                    <>
                      <label className="mt-3 block text-sm font-medium text-ink-800 dark:text-ink-200">
                        {t("automationPage.agentElevenLabsConfig")}
                        <select
                          value={agentForm.elevenLabsToolId}
                          onChange={(e) => setAgentForm((f) => ({ ...f, elevenLabsToolId: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                        >
                          <option value="">{t("automationPage.agentElevenLabsSelect")}</option>
                          {elevenLabsTools.map((tl) => (
                            <option key={tl.id} value={tl.id}>
                              {tl.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="mt-1 text-[11px] text-ink-500">
                        <button
                          type="button"
                          className="text-left text-brand-600 hover:underline"
                          onClick={onOpenToolsTab}
                        >
                          {t("automationPage.agentElevenLabsToolsTabHint")}
                        </button>
                      </p>
                      <p className="mt-3 text-sm font-medium text-ink-800 dark:text-ink-200">
                        {t("automationPage.agentVoicePercentLabel")}: {agentForm.voiceResponsePercent}%
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {VOICE_PERCENT_STEPS.map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setAgentForm((f) => ({ ...f, voiceResponsePercent: pct }))}
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                              agentForm.voiceResponsePercent === pct
                                ? "bg-brand-600 text-white"
                                : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-300",
                            )}
                          >
                            {pct === 0 ? t("automationPage.agentVoicePercent0") : `${pct}%`}
                          </button>
                        ))}
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={agentForm.voiceResponsePercent}
                        onChange={(e) =>
                          setAgentForm((f) => ({ ...f, voiceResponsePercent: Number(e.target.value) }))
                        }
                        className="mt-3 w-full accent-brand-600"
                      />
                      <p className="text-[11px] text-ink-500">{t("automationPage.agentVoicePercentHelp")}</p>
                    </>
                  ) : null}
                  <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      checked={agentForm.replyWithAudioOnInboundAudio}
                      onChange={(e) =>
                        setAgentForm((f) => ({ ...f, replyWithAudioOnInboundAudio: e.target.checked }))
                      }
                    />
                    <span>{t("automationPage.agentVoiceOnAudioInbound")}</span>
                  </label>
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentVoiceOnAudioInboundHelp")}</p>
                </div>
              ) : null}

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
                  <>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                        {t("automationPage.agentInactivityTimeout")}
                        <input
                          type="number"
                          min={1}
                          value={agentForm.inactivityTimeout}
                          onChange={(e) =>
                            setAgentForm((f) => ({ ...f, inactivityTimeout: Number(e.target.value) || 30 }))
                          }
                          className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                        />
                      </label>
                      <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                        {t("automationPage.agentInactivityMaxFollowups")}
                        <input
                          type="number"
                          min={1}
                          value={agentForm.inactivityFollowUpMax}
                          onChange={(e) =>
                            setAgentForm((f) => ({ ...f, inactivityFollowUpMax: Number(e.target.value) || 1 }))
                          }
                          className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-medium text-ink-700 dark:text-ink-300">
                      {t("automationPage.agentFollowUpMessage")}
                      <textarea
                        value={agentForm.followUpMessage}
                        onChange={(e) => setAgentForm((f) => ({ ...f, followUpMessage: e.target.value }))}
                        rows={3}
                        placeholder={t("automationPage.agentFollowUpMessagePh")}
                        className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                      />
                    </label>
                  </>
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

              <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {t("automationPage.agentEscalationSection")}
                </p>
                <label className="mt-2 block text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEscalationMode")}
                  <select
                    value={agentForm.escalationMode}
                    onChange={(e) => setAgentForm((f) => ({ ...f, escalationMode: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  >
                    <option value="keyword">{t("automationPage.agentEscalationModeKeyword")}</option>
                    <option value="llm">{t("automationPage.agentEscalationModeLlm")}</option>
                    <option value="always">{t("automationPage.agentEscalationModeAlways")}</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEscalationTeam")}
                  <select
                    value={agentForm.escalationTeamId}
                    onChange={(e) => setAgentForm((f) => ({ ...f, escalationTeamId: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  >
                    <option value="">{t("automationPage.agentEscalationTeamNone")}</option>
                    {orgTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEscalationKeywords")}
                  <input
                    value={agentForm.escalationKeywords}
                    onChange={(e) => setAgentForm((f) => ({ ...f, escalationKeywords: e.target.value }))}
                    placeholder={t("automationPage.agentEscalationKeywordsPh")}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
                <label className="mt-2 block text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEscalationConditions")}
                  <textarea
                    value={agentForm.escalationConditions}
                    onChange={(e) => setAgentForm((f) => ({ ...f, escalationConditions: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
                <label className="mt-2 block text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEscalationTransfer")}
                  <textarea
                    value={agentForm.escalationTransferMessage}
                    onChange={(e) => setAgentForm((f) => ({ ...f, escalationTransferMessage: e.target.value }))}
                    rows={2}
                    placeholder={t("automationPage.agentEscalationTransferPh")}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
                <div className="mt-2 flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(instructionSuggestBusy)}
                    onClick={() => {
                      void (async () => {
                        const tid = agentForm.escalationTeamId.trim();
                        const teamName = tid ? orgTeams.find((o) => o.id === tid)?.name : undefined;
                        try {
                          const text = await runSuggestInstruction("escalation", {
                            kind: "escalation",
                            agentContextSnippet: agentForm.promptUserCore,
                            escalationMode: agentForm.escalationMode,
                            escalationKeywords: agentForm.escalationKeywords,
                            escalationTransferMessage: agentForm.escalationTransferMessage,
                            teamId: tid || undefined,
                            teamName: teamName || undefined,
                          });
                          if (!text) return;
                          setAgentForm((f) => ({ ...f, escalationConditions: text }));
                        } catch (err) {
                          window.alert(
                            `${t("automationPage.promptBuilderSuggestError")}${err instanceof Error ? `\n${err.message}` : ""}`,
                          );
                        }
                      })();
                    }}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-800 shadow-sm hover:bg-brand-50 disabled:opacity-50 dark:border-brand-800 dark:bg-ink-900 dark:text-brand-200 dark:hover:bg-brand-950/40"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {instructionSuggestBusy === "escalation"
                      ? t("automationPage.promptBuilderSuggestBusy")
                      : t("automationPage.promptBuilderSuggestInstruction")}
                  </button>
                  <p className="text-[10px] text-ink-500">{t("automationPage.agentEscalationSuggestHelp")}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-brand-200/50 bg-gradient-to-br from-brand-50/40 via-white to-ink-50/90 p-4 shadow-sm dark:border-brand-900/30 dark:from-brand-950/25 dark:via-ink-900/30 dark:to-ink-950/80">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md dark:bg-brand-500">
                    <Blocks className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                        {t("automationPage.promptBuilderTitle")}
                      </h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                        {t("automationPage.promptBuilderHelp")}
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-ink-200/80 bg-white/90 p-0.5 shadow-sm dark:border-ink-600 dark:bg-ink-950/80">
                      <button
                        type="button"
                        onClick={() => setPromptEditorTab("builder")}
                        className={clsx(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          promptEditorTab === "builder"
                            ? "bg-brand-600 text-white shadow-sm"
                            : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
                        )}
                      >
                        {t("automationPage.promptBuilderTabBuilder")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromptEditorTab("merged")}
                        className={clsx(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          promptEditorTab === "merged"
                            ? "bg-brand-600 text-white shadow-sm"
                            : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
                        )}
                      >
                        {t("automationPage.promptBuilderTabMerged")}
                      </button>
                    </div>
                  </div>
                </div>

                {promptEditorTab === "merged" ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-ink-700 dark:text-ink-300">{t("automationPage.promptMergedTitle")}</p>
                    <p className="text-[11px] text-ink-500">{t("automationPage.promptMergedHelp")}</p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-ink-200 bg-ink-950/90 p-3 font-mono text-[11px] leading-relaxed text-ink-100 dark:border-ink-700">
                      {mergedPromptPreview || t("automationPage.agentSystemInstructionsPh")}
                    </pre>
                  </div>
                ) : (
                  <div className="mt-4 space-y-5">
                    <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                      {t("automationPage.promptUserCoreLabel")}
                      <textarea
                        value={agentForm.promptUserCore}
                        onChange={(e) => setAgentForm((f) => ({ ...f, promptUserCore: e.target.value }))}
                        rows={4}
                        placeholder={t("automationPage.agentSystemInstructionsPh")}
                        className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm leading-relaxed dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                      />
                      <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.promptUserCoreHint")}</p>
                    </label>

                    <div className="rounded-xl border border-ink-100 bg-white/80 p-3 dark:border-ink-700 dark:bg-ink-950/50">
                      <p className="text-xs font-semibold text-ink-900 dark:text-ink-100">{t("automationPage.promptKbSection")}</p>
                      <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.promptKbHint")}</p>
                      <p className="mt-2 text-[11px] leading-snug text-ink-600 dark:text-ink-400">
                        {kbScopeBotId
                          ? t("automationPage.promptKbCatalogLine")
                              .replace("{org}", String(orgKbActiveSyncCount))
                              .replace("{linked}", String(kbLinkedArticleCount ?? 0))
                          : t("automationPage.promptKbCatalogLineNoBot").replace(
                              "{org}",
                              String(orgKbActiveSyncCount),
                            )}
                      </p>
                      {!agentForm.nativeTools.knowledge_search ? (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                          <p>{t("automationPage.promptKbToolDisabledWarning")}</p>
                          <button
                            type="button"
                            onClick={onOpenKnowledgeTab}
                            className="mt-2 inline-flex text-[11px] font-semibold text-brand-700 underline hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
                          >
                            {t("automationPage.promptKbOpenKnowledgeTab")}
                          </button>
                        </div>
                      ) : (
                        <div
                          className={clsx(
                            "mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                            !kbScopeBotId
                              ? "border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                              : kbLinkedArticleCount === 0
                                ? "border-sky-200 bg-sky-50/90 text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-100"
                                : "border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100",
                          )}
                        >
                          {!kbScopeBotId ? (
                            <p>{t("automationPage.promptKbScopeNoBotYet")}</p>
                          ) : kbLinkedArticleCount === 0 ? (
                            <p>{t("automationPage.promptKbScopeOrgWide")}</p>
                          ) : (
                            <p>
                              {t("automationPage.promptKbScopeBotLinked").replace(
                                "{count}",
                                String(kbLinkedArticleCount),
                              )}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={onOpenKnowledgeTab}
                            className="mt-2 inline-flex text-[11px] font-semibold text-brand-700 underline hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
                          >
                            {t("automationPage.promptKbOpenKnowledgeTab")}
                          </button>
                        </div>
                      )}
                      <input
                        type="search"
                        value={kbArticleFilter}
                        onChange={(e) => setKbArticleFilter(e.target.value)}
                        placeholder={t("automationPage.promptKbSearch")}
                        className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                      />
                      {visibleKbArticles.length === 0 ? (
                        <p className="mt-3 text-xs text-ink-500">{t("automationPage.promptKbEmpty")}</p>
                      ) : (
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-100 bg-ink-50/50 p-2 dark:border-ink-800 dark:bg-ink-900/40">
                          {visibleKbArticles.map((a) => {
                            const checked = agentForm.promptLinkedKnowledgeIds.includes(a.id);
                            return (
                              <li key={a.id}>
                                <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-xs hover:bg-white/80 dark:hover:bg-ink-800/60">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-ink-300 text-brand-600"
                                    checked={checked}
                                    onChange={() =>
                                      setAgentForm((f) => {
                                        const set = new Set(f.promptLinkedKnowledgeIds);
                                        if (set.has(a.id)) set.delete(a.id);
                                        else set.add(a.id);
                                        return { ...f, promptLinkedKnowledgeIds: [...set] };
                                      })
                                    }
                                  />
                                  <span>
                                    <span className="font-medium text-ink-800 dark:text-ink-200">{a.title}</span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="rounded-xl border border-dashed border-brand-300/70 bg-brand-50/30 p-3 dark:border-brand-800/50 dark:bg-brand-950/20">
                      <p className="text-xs font-semibold text-brand-900 dark:text-brand-200">
                        {t("automationPage.promptGeneratedTitle")}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-400">{t("automationPage.promptGeneratedHelp")}</p>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-200/80 bg-white/90 p-3 font-mono text-[11px] leading-relaxed text-ink-800 dark:border-ink-700 dark:bg-ink-950 dark:text-ink-200">
                        {promptAutoPreview.trim() ? promptAutoPreview : t("automationPage.promptBuilderAutoEmpty")}
                      </pre>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-ink-800 dark:text-ink-200">{t("automationPage.agentNativeTools")}</p>
                      <p className="text-[11px] text-ink-500">{t("automationPage.agentNativeToolsHelp")}</p>
                      <p className="text-[11px] text-brand-700 dark:text-brand-400">
                        <button type="button" className="underline" onClick={onOpenToolsTab}>
                          {t("automationPage.agentNativeToolsTabLink")}
                        </button>
                      </p>
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

                    <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {t("automationPage.agentConnectedToolsTitle")}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentConnectedToolsHelp")}</p>
                {tools.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-500">{t("automationPage.agentConnectedToolsEmpty")}</p>
                ) : (
                  <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                    {tools.map((tl) => {
                      const existing = agentForm.connectedTools.find((x) => x.toolId === tl.id);
                      const enabled = Boolean(existing?.enabled);
                      const row: AgentConnectedToolRow = existing ?? {
                        toolId: tl.id,
                        enabled: false,
                        permission: "read",
                        maxCallsPerConversation: null,
                        priority: 0,
                        runMode: "auto",
                      };
                      return (
                        <li
                          key={tl.id}
                          className="rounded-lg border border-ink-200 bg-white px-2 py-2 dark:border-ink-600 dark:bg-ink-950/50"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-ink-800 dark:text-ink-200">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setAgentForm((f) => {
                                    const rest = f.connectedTools.filter((x) => x.toolId !== tl.id);
                                    if (!on) return { ...f, connectedTools: rest };
                                    return {
                                      ...f,
                                      connectedTools: [
                                        ...rest,
                                        {
                                          toolId: tl.id,
                                          enabled: true,
                                          permission: "read",
                                          maxCallsPerConversation: null,
                                          priority: 0,
                                          runMode: "auto",
                                          agentInstruction: undefined,
                                        },
                                      ],
                                    };
                                  });
                                }}
                              />
                              {tl.name}
                            </label>
                            <span className="text-[10px] text-ink-400">{tl.toolType}</span>
                          </div>
                          {enabled ? (
                            <div className="mt-2 grid gap-2 border-t border-ink-100 pt-2 dark:border-ink-800 sm:grid-cols-2">
                              <label className="text-[11px] font-medium text-ink-700 dark:text-ink-300">
                                {t("automationPage.agentConnectedPermission")}
                                <select
                                  className="mt-0.5 w-full rounded border border-ink-200 px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                  value={row.permission}
                                  onChange={(e) => {
                                    const v = e.target.value as AgentConnectedToolRow["permission"];
                                    setAgentForm((f) => ({
                                      ...f,
                                      connectedTools: f.connectedTools.map((x) =>
                                        x.toolId === tl.id ? { ...x, permission: v } : x,
                                      ),
                                    }));
                                  }}
                                >
                                  <option value="read">read</option>
                                  <option value="write">write</option>
                                  <option value="admin">admin</option>
                                </select>
                              </label>
                              <label className="text-[11px] font-medium text-ink-700 dark:text-ink-300">
                                {t("automationPage.agentConnectedRunMode")}
                                <select
                                  className="mt-0.5 w-full rounded border border-ink-200 px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                  value={row.runMode}
                                  onChange={(e) => {
                                    const v = e.target.value as AgentConnectedToolRow["runMode"];
                                    setAgentForm((f) => ({
                                      ...f,
                                      connectedTools: f.connectedTools.map((x) =>
                                        x.toolId === tl.id ? { ...x, runMode: v } : x,
                                      ),
                                    }));
                                  }}
                                >
                                  <option value="auto">{t("automationPage.agentConnectedRunAuto")}</option>
                                  <option value="manual">{t("automationPage.agentConnectedRunManual")}</option>
                                </select>
                              </label>
                              {row.runMode === "manual" &&
                              (tl.toolType === "HTTP_API" || tl.toolType === "WEBHOOK") ? (
                                <p className="text-[10px] leading-snug text-amber-800 dark:text-amber-200 sm:col-span-2">
                                  {t("automationPage.agentConnectedRunManualNativeHint")}
                                </p>
                              ) : null}
                              <label className="text-[11px] font-medium text-ink-700 dark:text-ink-300">
                                {t("automationPage.agentConnectedPriority")}
                                <input
                                  type="number"
                                  className="mt-0.5 w-full rounded border border-ink-200 px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                  value={row.priority}
                                  onChange={(e) => {
                                    const v = Number(e.target.value) || 0;
                                    setAgentForm((f) => ({
                                      ...f,
                                      connectedTools: f.connectedTools.map((x) =>
                                        x.toolId === tl.id ? { ...x, priority: v } : x,
                                      ),
                                    }));
                                  }}
                                />
                              </label>
                              <label className="text-[11px] font-medium text-ink-700 dark:text-ink-300">
                                {t("automationPage.agentConnectedMaxCalls")}
                                <input
                                  type="number"
                                  className="mt-0.5 w-full rounded border border-ink-200 px-1 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                  placeholder={t("automationPage.agentConnectedMaxCallsPh")}
                                  value={row.maxCallsPerConversation ?? ""}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const v = raw === "" ? null : Math.max(0, Number(raw) || 0);
                                    setAgentForm((f) => ({
                                      ...f,
                                      connectedTools: f.connectedTools.map((x) =>
                                        x.toolId === tl.id ? { ...x, maxCallsPerConversation: v } : x,
                                      ),
                                    }));
                                  }}
                                />
                              </label>
                              <div className="sm:col-span-2">
                                <label className="text-[11px] font-medium text-ink-700 dark:text-ink-300">
                                  {t("automationPage.agentConnectedToolInstruction")}
                                  <textarea
                                    rows={3}
                                    value={row.agentInstruction ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setAgentForm((f) => ({
                                        ...f,
                                        connectedTools: f.connectedTools.map((x) =>
                                          x.toolId === tl.id ? { ...x, agentInstruction: v } : x,
                                        ),
                                      }));
                                    }}
                                    placeholder={t("automationPage.agentConnectedToolInstructionHint")}
                                    className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1.5 text-xs leading-relaxed dark:border-ink-600 dark:bg-ink-900"
                                  />
                                  {tl.toolType === "HTTP_API" || tl.toolType === "WEBHOOK" ? (
                                    <p className="mt-1 text-[10px] leading-snug text-ink-500">
                                      {t("automationPage.agentConnectedToolNativeFnHint").replace(
                                        "{fn}",
                                        nativeOpenAiToolFunctionName(tl.id),
                                      )}
                                    </p>
                                  ) : null}
                                </label>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={Boolean(instructionSuggestBusy)}
                                    onClick={() => {
                                      void (async () => {
                                        const busyKey = `tool:${tl.id}`;
                                        const schema =
                                          tl.config && typeof tl.config === "object" && "parametersSchema" in tl.config
                                            ? JSON.stringify((tl.config as { parametersSchema?: unknown }).parametersSchema).slice(
                                                0,
                                                3500,
                                              )
                                            : "";
                                        try {
                                          const text = await runSuggestInstruction(busyKey, {
                                            kind: "connected_tool",
                                            agentContextSnippet: agentForm.promptUserCore,
                                            toolName: tl.name,
                                            toolDescription: [tl.description, schema ? `parameters_schema:\n${schema}` : ""]
                                              .filter(Boolean)
                                              .join("\n\n"),
                                          });
                                          if (!text) return;
                                          setAgentForm((f) => ({
                                            ...f,
                                            connectedTools: f.connectedTools.map((x) =>
                                              x.toolId === tl.id ? { ...x, agentInstruction: text } : x,
                                            ),
                                          }));
                                        } catch (err) {
                                          window.alert(
                                            `${t("automationPage.promptBuilderSuggestError")}${err instanceof Error ? `\n${err.message}` : ""}`,
                                          );
                                        }
                                      })();
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-800 dark:bg-ink-900 dark:text-brand-200 dark:hover:bg-brand-950/40"
                                  >
                                    <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                                    {instructionSuggestBusy === `tool:${tl.id}`
                                      ? t("automationPage.promptBuilderSuggestBusy")
                                      : t("automationPage.promptBuilderSuggestInstruction")}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-ink-100 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-800/40">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {t("automationPage.agentTeamTransferSection")}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentTeamTransferHelp")}</p>
                {!canTeamTransferHints ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                    {t("automationPage.agentTeamTransferNativeOff")}
                  </p>
                ) : null}
                {orgTeams.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-500">{t("automationPage.agentTeamTransferEmpty")}</p>
                ) : (
                  <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto">
                    {orgTeams.map((team) => {
                      const hintText =
                        agentForm.teamTransferHints.find((h) => h.teamId === team.id)?.instruction ?? "";
                      const busyKey = `team:${team.id}`;
                      return (
                        <li
                          key={team.id}
                          className="rounded-lg border border-ink-200 bg-white px-2 py-2 text-xs dark:border-ink-600 dark:bg-ink-950/50"
                        >
                          <div className="font-medium text-ink-800 dark:text-ink-200">{team.name}</div>
                          <code className="mt-0.5 block break-all text-[10px] text-ink-500">{team.id}</code>
                          <label className="mt-2 block text-[11px] font-medium text-ink-700 dark:text-ink-300">
                            {t("automationPage.agentTeamTransferInstructionLabel")}
                            <textarea
                              rows={3}
                              value={hintText}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAgentForm((f) => {
                                  const rest = f.teamTransferHints.filter((h) => h.teamId !== team.id);
                                  if (!v.trim()) return { ...f, teamTransferHints: rest };
                                  return { ...f, teamTransferHints: [...rest, { teamId: team.id, instruction: v }] };
                                });
                              }}
                              className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1.5 text-xs leading-relaxed dark:border-ink-600 dark:bg-ink-900"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(instructionSuggestBusy)}
                            onClick={() => {
                              void (async () => {
                                try {
                                  const text = await runSuggestInstruction(busyKey, {
                                    kind: "team_transfer",
                                    teamId: team.id,
                                    teamName: team.name,
                                    agentContextSnippet: agentForm.promptUserCore,
                                  });
                                  if (!text) return;
                                  setAgentForm((f) => {
                                    const rest = f.teamTransferHints.filter((h) => h.teamId !== team.id);
                                    return { ...f, teamTransferHints: [...rest, { teamId: team.id, instruction: text }] };
                                  });
                                } catch (err) {
                                  window.alert(
                                    `${t("automationPage.promptBuilderSuggestError")}${err instanceof Error ? `\n${err.message}` : ""}`,
                                  );
                                }
                              })();
                            }}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-800 dark:bg-ink-900 dark:text-brand-200 dark:hover:bg-brand-950/40"
                          >
                            <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                            {instructionSuggestBusy === busyKey
                              ? t("automationPage.promptBuilderSuggestBusy")
                              : t("automationPage.promptBuilderSuggestInstruction")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {prompts.length > 0 ? (
                <fieldset>
                  <legend className="text-sm font-medium text-ink-800 dark:text-ink-200">{t("automationPage.agentPromptModulesPick")}</legend>
                  <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentPromptModulesMergeHint")}</p>
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded border border-ink-100 p-2 dark:border-ink-700">
                    {prompts.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={agentForm.promptModuleIds.includes(p.id)}
                          onChange={(e) => {
                            const on = e.target.checked;
                            const nextIds = on
                              ? [...agentForm.promptModuleIds, p.id]
                              : agentForm.promptModuleIds.filter((id) => id !== p.id);
                            applyPromptModulesSelection(nextIds);
                          }}
                        />
                        {p.name} <span className="opacity-60">({p.slug})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 px-5 py-4 dark:border-ink-800">
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

const GOOGLE_CAL_DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

function HttpLikeToolEditor({
  tool,
  t,
  onSave,
}: {
  tool: AutomationCustomToolRow;
  t: Translate;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const c = (tool.config ?? {}) as Record<string, unknown>;
  const isWebhook = tool.toolType === "WEBHOOK";
  const [baseUrl, setBaseUrl] = useState(String(c.baseUrl ?? ""));
  const [webhookUrl, setWebhookUrl] = useState(String(c.webhookUrl ?? ""));
  const [httpMethod, setHttpMethod] = useState(String(c.httpMethod ?? "GET"));
  const [httpPath, setHttpPath] = useState(String(c.httpPath ?? "/"));
  const [authType, setAuthType] = useState(String(c.authType ?? "none"));
  const [bearerToken, setBearerToken] = useState("");
  const [apiKeyHeader, setApiKeyHeader] = useState(String(c.apiKeyHeader ?? "X-Api-Key"));
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [basicUser, setBasicUser] = useState(String(c.basicUser ?? ""));
  const [basicPassword, setBasicPassword] = useState("");
  const [customAuthHeader, setCustomAuthHeader] = useState(String(c.customAuthHeader ?? ""));
  const [customAuthValue, setCustomAuthValue] = useState("");
  const [defaultHeadersJson, setDefaultHeadersJson] = useState(() =>
    JSON.stringify((c.defaultHeaders && typeof c.defaultHeaders === "object" ? c.defaultHeaders : {}) as object, null, 2),
  );
  const [defaultQueryJson, setDefaultQueryJson] = useState(() =>
    JSON.stringify((c.defaultQuery && typeof c.defaultQuery === "object" ? c.defaultQuery : {}) as object, null, 2),
  );
  const fieldCls =
    "mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100";

  const handleSave = () => {
    let defaultHeaders: Record<string, unknown> = {};
    let defaultQuery: Record<string, unknown> = {};
    try {
      defaultHeaders = JSON.parse(defaultHeadersJson || "{}") as Record<string, unknown>;
    } catch {
      window.alert(t("automationPage.toolsCreateConfigInvalid"));
      return;
    }
    try {
      defaultQuery = JSON.parse(defaultQueryJson || "{}") as Record<string, unknown>;
    } catch {
      window.alert(t("automationPage.toolsCreateConfigInvalid"));
      return;
    }
    const patch: Record<string, unknown> = {
      httpMethod,
      authType,
      defaultHeaders,
      defaultQuery,
      executor: c.executor ?? "http_client",
    };
    for (const k of ["presetKey", "nativeToolKey"] as const) {
      const v = c[k];
      if (typeof v === "string" && v) patch[k] = v;
    }
    if (isWebhook) {
      patch.webhookUrl = webhookUrl.trim();
    } else {
      patch.baseUrl = baseUrl.trim();
      patch.httpPath = httpPath.trim() || "/";
    }
    if (authType === "bearer" || authType === "bearer_token") {
      if (bearerToken.trim()) patch.bearerToken = bearerToken.trim();
    } else if (authType === "api_key") {
      patch.apiKeyHeader = apiKeyHeader.trim() || "X-Api-Key";
      if (apiKeyValue.trim()) patch.apiKeyValue = apiKeyValue.trim();
    } else if (authType === "basic") {
      patch.basicUser = basicUser.trim();
      if (basicPassword.trim()) patch.basicPassword = basicPassword.trim();
    } else if (authType === "custom_header") {
      patch.customAuthHeader = customAuthHeader.trim();
      if (customAuthValue.trim()) patch.customAuthValue = customAuthValue.trim();
    }
    onSave(patch);
  };

  return (
    <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
      <p className="text-xs text-ink-500">{t("automationPage.toolHttpEditorHelp")}</p>
      {isWebhook ? (
        <label className="block text-xs font-medium">
          Webhook URL
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className={fieldCls} />
        </label>
      ) : (
        <>
          <label className="block text-xs font-medium">
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Path
            <input value={httpPath} onChange={(e) => setHttpPath(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            {t("automationPage.toolDefaultQueryJson")}
            <textarea
              value={defaultQueryJson}
              onChange={(e) => setDefaultQueryJson(e.target.value)}
              rows={4}
              placeholder='{"arrival_date":"{{arrival_date}}","adults":"2"}'
              className={clsx(fieldCls, "font-mono text-[11px]")}
            />
          </label>
          <p className="text-[10px] text-ink-500">{t("automationPage.toolDefaultQueryHint")}</p>
        </>
      )}
      <label className="block text-xs font-medium">
        {t("automationPage.toolHttpMethod")}
        <select value={httpMethod} onChange={(e) => setHttpMethod(e.target.value)} className={fieldCls}>
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium">
        {t("automationPage.toolAuthType")}
        <select value={authType} onChange={(e) => setAuthType(e.target.value)} className={fieldCls}>
          <option value="none">none</option>
          <option value="bearer">Bearer</option>
          <option value="api_key">API Key header</option>
          <option value="basic">Basic</option>
          <option value="custom_header">Custom header</option>
        </select>
      </label>
      {(authType === "bearer" || authType === "bearer_token") && (
        <label className="block text-xs font-medium">
          Bearer token
          <input type="password" autoComplete="off" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} className={fieldCls} />
        </label>
      )}
      {authType === "api_key" && (
        <>
          <label className="block text-xs font-medium">
            Header name
            <input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            API key
            <input type="password" autoComplete="off" value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} className={fieldCls} />
          </label>
        </>
      )}
      {authType === "basic" && (
        <>
          <label className="block text-xs font-medium">
            User
            <input value={basicUser} onChange={(e) => setBasicUser(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Password
            <input type="password" autoComplete="off" value={basicPassword} onChange={(e) => setBasicPassword(e.target.value)} className={fieldCls} />
          </label>
        </>
      )}
      {authType === "custom_header" && (
        <>
          <label className="block text-xs font-medium">
            Header
            <input value={customAuthHeader} onChange={(e) => setCustomAuthHeader(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Value
            <input type="password" autoComplete="off" value={customAuthValue} onChange={(e) => setCustomAuthValue(e.target.value)} className={fieldCls} />
          </label>
        </>
      )}
      <label className="block text-xs font-medium">
        {t("automationPage.toolDefaultHeadersJson")}
        <textarea value={defaultHeadersJson} onChange={(e) => setDefaultHeadersJson(e.target.value)} rows={4} className={clsx(fieldCls, "font-mono text-[11px]")} />
      </label>
      <button type="button" onClick={handleSave} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
        {t("automationPage.toolSaveCredentials")}
      </button>
    </div>
  );
}

function IntegrationToolEditor({
  tool,
  t,
  onSave,
}: {
  tool: AutomationCustomToolRow;
  t: Translate;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const c = (tool.config ?? {}) as Record<string, unknown>;
  const provider = String(c.provider ?? "");
  const [baseUrl, setBaseUrl] = useState(String(c.baseUrl ?? c.apiBaseUrl ?? ""));
  const [secret, setSecret] = useState("");
  const [extraJson, setExtraJson] = useState("{}");

  const fieldCls =
    "mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100";

  const handleSave = () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(extraJson) as Record<string, unknown>;
    } catch {
      window.alert(t("automationPage.toolsCreateConfigInvalid"));
      return;
    }
    const patch: Record<string, unknown> = { ...parsed, provider };
    if (baseUrl.trim()) {
      patch.baseUrl = baseUrl.trim();
      patch.apiBaseUrl = baseUrl.trim();
    }
    if (secret.trim()) {
      if (provider === "stripe") patch.secretKey = secret.trim();
      else if (provider === "slack") patch.botToken = secret.trim();
      else if (provider === "twilio") patch.authToken = secret.trim();
      else if (provider === "groq" || provider === "openai" || provider === "anthropic") patch.apiKey = secret.trim();
      else if (provider === "evolution_api") patch.apiKey = secret.trim();
      else if (provider === "chatwoot") patch.accessToken = secret.trim();
      else patch.apiKey = secret.trim();
    }
    for (const k of ["presetKey", "executor"] as const) {
      const v = c[k];
      if (typeof v === "string" && v) patch[k] = v;
    }
    onSave(patch);
  };

  return (
    <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
      <p className="text-xs text-ink-500">
        {t("automationPage.toolIntegrationHelp")} <span className="font-mono">({provider})</span>
      </p>
      <label className="block text-xs font-medium">
        Base URL (se aplicável)
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={fieldCls} />
      </label>
      <label className="block text-xs font-medium">
        {t("automationPage.toolIntegrationSecret")}
        <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className={fieldCls} />
      </label>
      <label className="block text-xs font-medium">
        {t("automationPage.toolIntegrationConfigJson")}
        <textarea value={extraJson} onChange={(e) => setExtraJson(e.target.value)} rows={6} className={clsx(fieldCls, "font-mono text-[11px]")} />
      </label>
      <button type="button" onClick={handleSave} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
        {t("automationPage.toolSaveCredentials")}
      </button>
    </div>
  );
}

function parseGoogleCalAvailability(cfg: Record<string, unknown>): { days: number[]; start: string; end: string } {
  const av = (cfg.availability && typeof cfg.availability === "object" ? cfg.availability : {}) as Record<string, unknown>;
  const daysRaw = Array.isArray(av.days) ? (av.days as unknown[]) : [1, 2, 3, 4, 5];
  let days = [...new Set(daysRaw.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (days.length === 0) days = [1, 2, 3, 4, 5];
  return {
    days,
    start: String(av.start ?? "09:00"),
    end: String(av.end ?? "18:00"),
  };
}

function GoogleCalendarToolEditor({
  tool,
  t,
  onSave,
}: {
  tool: AutomationCustomToolRow;
  t: Translate;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const c = (tool.config ?? {}) as Record<string, unknown>;
  const av0 = parseGoogleCalAvailability(c);
  const [clientId, setClientId] = useState(String(c.client_id ?? ""));
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [calendarId, setCalendarId] = useState(String(c.calendar_id ?? "primary"));
  const [days, setDays] = useState<number[]>(av0.days);
  const [startTime, setStartTime] = useState(av0.start);
  const [endTime, setEndTime] = useState(av0.end);
  const [calendarsJson, setCalendarsJson] = useState(() =>
    JSON.stringify(
      Array.isArray(c.connectedCalendars) ? c.connectedCalendars : [{ id: "primary", name: "Principal" }],
      null,
      2,
    ),
  );
  const [calPreview, setCalPreview] = useState<unknown>(() =>
    Array.isArray(c.connectedCalendars) ? c.connectedCalendars : [{ id: "primary", name: "Principal" }],
  );

  useEffect(() => {
    const cfg = (tool.config ?? {}) as Record<string, unknown>;
    const av = parseGoogleCalAvailability(cfg);
    setClientId(String(cfg.client_id ?? ""));
    setClientSecret("");
    setRefreshToken("");
    setCalendarId(String(cfg.calendar_id ?? "primary"));
    setDays(av.days);
    setStartTime(av.start);
    setEndTime(av.end);
    const cal = Array.isArray(cfg.connectedCalendars) ? cfg.connectedCalendars : [{ id: "primary", name: "Principal" }];
    setCalendarsJson(JSON.stringify(cal, null, 2));
    setCalPreview(cal);
  }, [tool.id]);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const refreshCalPreview = () => {
    try {
      const parsed = JSON.parse(calendarsJson);
      if (!Array.isArray(parsed)) {
        window.alert(t("automationPage.toolGoogleCalendarCalendarsJsonInvalid"));
        return;
      }
      setCalPreview(parsed);
    } catch {
      window.alert(t("automationPage.toolGoogleCalendarCalendarsJsonInvalid"));
    }
  };

  const fieldCls =
    "mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100";

  const handleSave = () => {
    let connectedCalendars: unknown;
    try {
      connectedCalendars = JSON.parse(calendarsJson);
    } catch {
      window.alert(t("automationPage.toolGoogleCalendarCalendarsJsonInvalid"));
      return;
    }
    if (!Array.isArray(connectedCalendars)) {
      window.alert(t("automationPage.toolGoogleCalendarCalendarsJsonInvalid"));
      return;
    }
    const patch: Record<string, unknown> = {
      auth_mode: "oauth",
      client_id: clientId.trim(),
      calendar_id: calendarId.trim() || "primary",
      availability: { days, start: startTime.trim() || "09:00", end: endTime.trim() || "18:00" },
      connectedCalendars,
    };
    if (clientSecret.trim()) patch.client_secret = clientSecret.trim();
    if (refreshToken.trim()) patch.refresh_token = refreshToken.trim();
    for (const k of ["presetKey", "nativeToolKey", "executor"] as const) {
      const v = c[k];
      if (typeof v === "string" && v) patch[k] = v;
    }
    onSave(patch);
  };

  const listItems = Array.isArray(calPreview)
    ? (calPreview as Array<Record<string, unknown>>).filter((x) => x && typeof x === "object")
    : [];

  return (
    <div className="mt-3 space-y-3 border-t border-ink-200 pt-3 dark:border-ink-700">
      <p className="text-xs text-ink-500">{t("automationPage.toolGoogleCalendarHelp")}</p>
      <label className="block text-xs font-medium">
        OAuth client ID
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={fieldCls} />
      </label>
      <label className="block text-xs font-medium">
        OAuth client secret
        <input
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={t("automationPage.toolGoogleCalendarSecretPlaceholder")}
          className={fieldCls}
        />
      </label>
      <label className="block text-xs font-medium">
        Refresh token (offline)
        <input
          type="password"
          autoComplete="off"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          placeholder={t("automationPage.toolGoogleCalendarRefreshPlaceholder")}
          className={fieldCls}
        />
      </label>
      <label className="block text-xs font-medium">
        Calendar ID (default)
        <input value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={fieldCls} />
      </label>

      <div>
        <p className="text-xs font-medium text-ink-800 dark:text-ink-200">{t("automationPage.toolGoogleCalendarAvailabilityTitle")}</p>
        <p className="mt-0.5 text-[11px] text-ink-500">{t("automationPage.toolGoogleCalendarDaysHint")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GOOGLE_CAL_DAY_INDEXES.map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600"
                checked={days.includes(d)}
                onChange={() => toggleDay(d)}
              />
              {t(`automationPage.toolCalDay_${d}`)}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            {t("automationPage.toolGoogleCalendarFrom")}
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldCls} />
          </label>
          <label className="flex items-center gap-1">
            {t("automationPage.toolGoogleCalendarTo")}
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={fieldCls} />
          </label>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-800 dark:text-ink-200">{t("automationPage.toolGoogleCalendarConnectedTitle")}</p>
          <button
            type="button"
            onClick={refreshCalPreview}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline"
          >
            <RefreshCw className="h-3 w-3" />
            {t("automationPage.toolGoogleCalendarRefreshList")}
          </button>
        </div>
        <textarea
          value={calendarsJson}
          onChange={(e) => setCalendarsJson(e.target.value)}
          rows={5}
          className={clsx(fieldCls, "mt-1 font-mono text-[11px]")}
        />
        <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.toolGoogleCalendarConsultHint")}</p>
        {listItems.length > 0 ? (
          <ul className="mt-2 space-y-1.5 rounded-lg border border-ink-100 bg-white p-2 dark:border-ink-700 dark:bg-ink-950/40">
            {listItems.map((row, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-ink-700 dark:text-ink-300">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span>
                  <span className="font-medium">{String(row.name ?? row.id ?? "—")}</span>
                  {row.id != null ? (
                    <span className="mt-0.5 block text-[10px] text-ink-500">ID: {String(row.id)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="text-[11px] text-ink-500">{t("automationPage.toolGoogleCalendarOAuthNote")}</p>

      <button
        type="button"
        onClick={handleSave}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
      >
        {t("automationPage.toolSaveCredentials")}
      </button>
    </div>
  );
}

function ToolCredentialEditor({
  tool,
  t,
  onSave,
}: {
  tool: AutomationCustomToolRow;
  t: Translate;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const c = (tool.config ?? {}) as Record<string, unknown>;
  const provider = String(c.provider ?? "");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [voiceId, setVoiceId] = useState(String(c.voiceId ?? ""));
  const [modelId, setModelId] = useState(String(c.modelId ?? "eleven_multilingual_v2"));
  const [fromEmail, setFromEmail] = useState(String(c.fromEmail ?? ""));
  const [domain, setDomain] = useState(String(c.domain ?? ""));
  const [host, setHost] = useState(String(c.host ?? ""));
  const [port, setPort] = useState(String(c.port ?? "587"));
  const [username, setUsername] = useState(String(c.username ?? ""));
  const [password, setPassword] = useState("");

  const fieldCls =
    "mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100";

  if (tool.toolType === "GOOGLE_CALENDAR") {
    return <GoogleCalendarToolEditor tool={tool} t={t} onSave={onSave} />;
  }

  if (tool.toolType === "HTTP_API" || tool.toolType === "WEBHOOK") {
    return <HttpLikeToolEditor tool={tool} t={t} onSave={onSave} />;
  }

  if (tool.toolType === "INTEGRATION") {
    return <IntegrationToolEditor tool={tool} t={t} onSave={onSave} />;
  }

  if (tool.toolType === "MCP") {
    return <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("automationPage.toolMcpNoSecrets")}</p>;
  }

  if (tool.toolType === "ELEVENLABS") {
    return (
      <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
        <p className="text-xs text-ink-500">{t("automationPage.toolElevenHelp")}</p>
        <label className="block text-xs font-medium">
          API key
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={fieldCls} />
        </label>
        <label className="block text-xs font-medium">
          Voice ID
          <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={fieldCls} />
        </label>
        <label className="block text-xs font-medium">
          Model ID
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} className={fieldCls} />
        </label>
        <button
          type="button"
          onClick={() => onSave({ apiKey, voiceId, modelId })}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          {t("automationPage.toolSaveCredentials")}
        </button>
      </div>
    );
  }

  if (tool.toolType === "EMAIL_API") {
    if (provider === "gmail") {
      return (
        <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
          <label className="block text-xs font-medium">
            OAuth access token
            <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            From e-mail
            <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={fieldCls} />
          </label>
          <button
            type="button"
            onClick={() => onSave({ accessToken, fromEmail })}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {t("automationPage.toolSaveCredentials")}
          </button>
        </div>
      );
    }
    if (provider === "smtp") {
      return (
        <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
          <label className="block text-xs font-medium">
            Host
            <input value={host} onChange={(e) => setHost(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Port
            <input value={port} onChange={(e) => setPort(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium">
            From e-mail
            <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={fieldCls} />
          </label>
          <button
            type="button"
            onClick={() =>
              onSave({ host, port, username, password, fromEmail })
            }
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {t("automationPage.toolSaveCredentials")}
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3 space-y-2 border-t border-ink-200 pt-3 dark:border-ink-700">
        <label className="block text-xs font-medium">
          API key
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={fieldCls} />
        </label>
        {provider === "mailgun" ? (
          <label className="block text-xs font-medium">
            Domain
            <input value={domain} onChange={(e) => setDomain(e.target.value)} className={fieldCls} />
          </label>
        ) : null}
        <label className="block text-xs font-medium">
          From e-mail
          <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={fieldCls} />
        </label>
        <button
          type="button"
          onClick={() => {
            const p: Record<string, unknown> = { apiKey, fromEmail };
            if (provider === "mailgun" && domain.trim()) p.domain = domain;
            onSave(p);
          }}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          {t("automationPage.toolSaveCredentials")}
        </button>
      </div>
    );
  }

  return (
    <p className="mt-2 text-xs text-ink-500">
      {tool.toolType} — {t("automationPage.toolGenericEditorHint")}
    </p>
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
