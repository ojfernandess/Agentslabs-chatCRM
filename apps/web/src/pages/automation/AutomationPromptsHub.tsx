import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  BookTemplate,
  ChevronDown,
  Copy,
  FileJson,
  History,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { AutomationCustomToolRow } from "./automationToolTypes";
import {
  parsePromptLabels,
  type PromptHistoryEntry,
  type PromptLabels,
  type PromptLlmDefaults,
  type PromptModuleRow,
  type PromptStatus,
} from "./promptHubTypes";

const CATEGORY_IDS = [
  "general",
  "support",
  "sales",
  "hotel",
  "crm",
  "finance",
  "marketing",
  "billing",
  "followup",
  "checkin",
  "qualification",
] as const;

const STATUS_ORDER: PromptStatus[] = ["production", "active", "test", "draft"];

const VARIABLE_SNIPPETS = [
  "{{contact.name}}",
  "{{message}}",
  "{{reservation.code}}",
  "{{conversation.history}}",
  "{{conversation.id}}",
  "{{agent.name}}",
  "{{custom.variable}}",
];

const COLOR_ACCENTS: Record<string, string> = {
  violet: "from-violet-500/20 to-fuchsia-500/10 ring-violet-500/20",
  sky: "from-sky-500/20 to-cyan-500/10 ring-sky-500/20",
  emerald: "from-emerald-500/20 to-teal-500/10 ring-emerald-500/20",
  amber: "from-amber-500/20 to-orange-500/10 ring-amber-500/20",
  rose: "from-rose-500/20 to-pink-500/10 ring-rose-500/20",
  slate: "from-slate-500/15 to-zinc-500/10 ring-slate-500/20",
};

const PROMPT_BLOCK_SNIPPETS = [
  { key: "persona", heading: "## Persona\n" },
  { key: "rules", heading: "## Regras\n- \n" },
  { key: "context", heading: "## Contexto\n{{conversation.history}}\n\n" },
  { key: "tools", heading: "## Ferramentas\n(Quando usar cada ferramenta)\n\n" },
  { key: "goal", heading: "## Objetivo\n" },
  { key: "constraints", heading: "## Restrições\n- Não invente dados factuais.\n" },
];

type TemplateDef = {
  id: string;
  categoryKey: (typeof CATEGORY_IDS)[number];
  nameKey: string;
  descKey: string;
  modelHint: string;
  body: string;
};

const BUILT_IN_TEMPLATES: TemplateDef[] = [
  {
    id: "tpl_support_sac",
    categoryKey: "support",
    nameKey: "templateName_sac",
    descKey: "templateDesc_sac",
    modelHint: "gpt-4o",
    body: "## Persona\nAssistente de SAC empático e objetivo.\n\n## Regras\n- Confirme o pedido antes de encerrar.\n- Escale para humano se o cliente pedir.\n\n## Contexto\n{{conversation.history}}\n\n## Dados do contacto\n{{contact.name}}\n\n## Mensagem atual\n{{message}}\n",
  },
  {
    id: "tpl_sales_sdr",
    categoryKey: "qualification",
    nameKey: "templateName_sdr",
    descKey: "templateDesc_sdr",
    modelHint: "gpt-4o-mini",
    body: "## Persona\nSDR B2B consultivo.\n\n## Objetivo\nQualificar interesse e agendar próximo passo.\n\n## Instruções\n- Faça uma pergunta de cada vez.\n- Registe necessidade, prazo e orçamento.\n\n{{message}}\n",
  },
  {
    id: "tpl_hotel_checkin",
    categoryKey: "checkin",
    nameKey: "templateName_checkin",
    descKey: "templateDesc_checkin",
    modelHint: "gpt-4o",
    body: "## Persona\nRececionista digital do hotel.\n\n## Contexto da reserva\nCódigo: {{reservation.code}}\n\n## Mensagem\n{{message}}\n\n## Regras\n- Confirme identidade antes de dados sensíveis.\n- Ofereça horário de check-in e Wi‑Fi.\n",
  },
  {
    id: "tpl_billing",
    categoryKey: "billing",
    nameKey: "templateName_billing",
    descKey: "templateDesc_billing",
    modelHint: "gpt-4o-mini",
    body: "## Persona\nAgente de cobrança respeitoso.\n\n## Objetivo\nLembrar pagamento e oferecer opções.\n\n## Restrições\n- Sem ameaças nem linguagem agressiva.\n\nCliente: {{contact.name}}\nMensagem: {{message}}\n",
  },
];

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function HubIcon({ name, className }: { name: string; className?: string }) {
  const Cmp =
    (LucideIcons as unknown as Record<string, LucideIcon>)[name] ?? LucideIcons.Sparkles;
  return <Cmp className={className} strokeWidth={1.5} />;
}

function countPromptUsage(
  promptId: string,
  profiles: Array<{ promptModuleIds: unknown }>,
): number {
  let n = 0;
  for (const p of profiles) {
    const ids = p.promptModuleIds;
    if (!Array.isArray(ids)) continue;
    if (ids.includes(promptId)) n++;
  }
  return n;
}

function resolveVariables(body: string, sample: Record<string, string>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    return sample[key] ?? `{{${key}}}`;
  });
}

const IMPROVE_SCAFFOLD = `

---

## Estrutura sugerida (melhoria assistida)
### Persona
Quem é o agente e para quem fala.

### Regras operacionais
- Tom e limites claros.
- O que nunca deve fazer.

### Contexto dinâmico
Use variáveis como {{contact.name}}, {{message}}, {{conversation.history}}.

### Objetivo mensurável
Um resultado concreto por conversa.

### Restrições anti-alucinação
- Cite apenas dados fornecidos no contexto.
- Se faltar informação, peça confirmação.
`;

type EditorTab = "editor" | "preview" | "variables" | "tools" | "history";

export function AutomationPromptsHub({
  t,
  loading,
  setLoading,
  setError,
  prompts,
  tools,
  agentProfiles,
  userDisplayName,
  onRefresh,
  onNavigateAgents,
  onOpenToolsTab,
  onCreateAgentFromPrompt,
}: {
  t: (path: string) => string;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (code: string) => void;
  prompts: PromptModuleRow[];
  tools: AutomationCustomToolRow[];
  agentProfiles: Array<{ promptModuleIds: unknown }>;
  userDisplayName: string | null;
  onRefresh: () => Promise<void>;
  onNavigateAgents: () => void;
  onOpenToolsTab: () => void;
  /** After saving a new module, open agent modal with LLM + body pre-filled */
  onCreateAgentFromPrompt?: (row: PromptModuleRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [promptHubBuilderSubTab, setPromptHubBuilderSubTab] = useState<"builder" | "merged">("builder");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [draftVersion, setDraftVersion] = useState(1);
  const [draftBody, setDraftBody] = useState("");
  const [draftCategory, setDraftCategory] = useState<string>("general");
  const [draftTags, setDraftTags] = useState("");
  const [draftStatus, setDraftStatus] = useState<PromptStatus>("active");
  const [draftModelHint, setDraftModelHint] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftIcon, setDraftIcon] = useState("Sparkles");
  const [draftColor, setDraftColor] = useState("violet");
  const [draftConnectedToolIds, setDraftConnectedToolIds] = useState<string[]>([]);

  const [previewMessages, setPreviewMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [previewInput, setPreviewInput] = useState("");
  const [previewLiveMode, setPreviewLiveMode] = useState(true);
  const [previewProvider, setPreviewProvider] = useState<"openai" | "google_gemini">("openai");
  const [previewModel, setPreviewModel] = useState("gpt-4o-mini");
  const [previewTemperature, setPreviewTemperature] = useState(0.7);
  const [previewMaxTokens, setPreviewMaxTokens] = useState(1024);
  const [previewApiKey, setPreviewApiKey] = useState("");
  const [previewBaseUrl, setPreviewBaseUrl] = useState("https://api.openai.com/v1");
  const [previewRecordMetrics, setPreviewRecordMetrics] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewOptions, setPreviewOptions] = useState<{
    hasPlatformOpenAiKey: boolean;
    hasPlatformGeminiKey: boolean;
  } | null>(null);
  const [sampleCtx, setSampleCtx] = useState({
    "contact.name": "Maria Silva",
    message: "Quero fazer o check-in",
    "reservation.code": "RES-9921",
    "conversation.history": "Cliente perguntou horário de chegada.",
    "agent.name": "Concierge IA",
  });

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [createAgentAfterSave, setCreateAgentAfterSave] = useState(false);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of prompts) {
      for (const tag of parsePromptLabels(p.labels).tags ?? []) s.add(tag);
    }
    return [...s].sort();
  }, [prompts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tf = tagFilter.trim().toLowerCase();
    return prompts.filter((p) => {
      const lb = parsePromptLabels(p.labels);
      const tags = lb.tags ?? [];
      const desc = lb.description ?? "";
      if (categoryFilter !== "all" && lb.category !== categoryFilter) return false;
      if (tf && !tags.some((x) => x.toLowerCase().includes(tf))) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q) ||
        tags.some((x) => x.toLowerCase().includes(q))
      );
    });
  }, [prompts, search, categoryFilter, tagFilter]);

  const openNew = useCallback(() => {
    setDraftId(null);
    setDraftName("");
    setDraftSlug("");
    setDraftVersion(1);
    setDraftBody("");
    setDraftCategory("general");
    setDraftTags("");
    setDraftStatus("active");
    setDraftModelHint("gpt-4o-mini");
    setDraftDescription("");
    setDraftIcon("Sparkles");
    setDraftColor("violet");
    setDraftConnectedToolIds([]);
    setSlugTouched(false);
    setEditorTab("editor");
    setPromptHubBuilderSubTab("builder");
    setPreviewMessages([]);
    setPreviewInput("");
    setPreviewLiveMode(true);
    setPreviewProvider("openai");
    setPreviewModel("gpt-4o-mini");
    setPreviewTemperature(0.7);
    setPreviewMaxTokens(1024);
    setPreviewApiKey("");
    setPreviewBaseUrl("https://api.openai.com/v1");
    setPreviewRecordMetrics(false);
    setPreviewError("");
    setCreateAgentAfterSave(false);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((row: PromptModuleRow) => {
    const lb = parsePromptLabels(row.labels);
    setDraftId(row.id);
    setDraftName(row.name);
    setDraftSlug(row.slug);
    setDraftVersion(row.version);
    setDraftBody(row.body);
    setDraftCategory(lb.category ?? "general");
    setDraftTags((lb.tags ?? []).join(", "));
    setDraftStatus(lb.status ?? "active");
    setDraftModelHint(lb.modelHint ?? "");
    setDraftDescription(lb.description ?? "");
    setDraftIcon(lb.icon ?? "Sparkles");
    setDraftColor(lb.color ?? "violet");
    setDraftConnectedToolIds(lb.connectedToolIds ?? []);
    setSlugTouched(true);
    setEditorTab("editor");
    setPromptHubBuilderSubTab("builder");
    setPreviewMessages([]);
    setPreviewInput("");
    const ld = lb.llmDefaults;
    if (ld) {
      setPreviewProvider(ld.provider);
      setPreviewModel(ld.model);
      setPreviewTemperature(ld.temperature);
      setPreviewMaxTokens(ld.maxTokens);
      if (ld.provider === "openai") {
        setPreviewBaseUrl(ld.apiBaseUrl?.trim() || "https://api.openai.com/v1");
      }
    } else {
      setPreviewModel((lb.modelHint ?? "").trim() || "gpt-4o-mini");
      setPreviewProvider(/gemini/i.test(lb.modelHint ?? "") ? "google_gemini" : "openai");
    }
    setPreviewRecordMetrics(false);
    setPreviewError("");
    setCreateAgentAfterSave(false);
    setEditorOpen(true);
  }, []);

  useEffect(() => {
    if (!editorOpen || editorTab !== "preview") return;
    let cancelled = false;
    void (async () => {
      try {
        const o = await api.get<{
          hasPlatformOpenAiKey: boolean;
          hasPlatformGeminiKey: boolean;
        }>("/automation/prompt-modules/preview-options");
        if (!cancelled) setPreviewOptions(o);
      } catch {
        if (!cancelled) setPreviewOptions(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editorOpen, editorTab]);

  const saveDraft = async () => {
    const name = draftName.trim();
    const slug = (draftSlug.trim() || slugify(name)).replace(/[^a-z0-9_]/g, "_");
    const body = draftBody.trim();
    if (!name || !slug || !body) {
      setError("prompt_validation");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const prevRow = draftId ? prompts.find((x) => x.id === draftId) : null;
      const prevBody = prevRow?.body ?? "";
      const prevLabels = parsePromptLabels(prevRow?.labels);
      const hist = [...(prevLabels.history ?? [])];
      if (draftId && prevRow && prevBody !== body) {
        hist.unshift({
          at: new Date().toISOString(),
          version: prevRow.version,
          body: prevBody,
        });
      }
      const tags = draftTags
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const llmDefaults: PromptLlmDefaults = {
        provider: previewProvider,
        model: previewModel.trim() || draftModelHint.trim() || "gpt-4o-mini",
        temperature: previewTemperature,
        maxTokens: previewMaxTokens,
        apiBaseUrl: previewProvider === "openai" ? previewBaseUrl.trim() || null : null,
      };
      const labels: PromptLabels = {
        category: draftCategory,
        tags,
        status: draftStatus,
        modelHint: previewModel.trim() || draftModelHint.trim(),
        description: draftDescription.trim(),
        icon: draftIcon,
        color: draftColor,
        connectedToolIds: draftConnectedToolIds,
        llmDefaults,
        history: hist.slice(0, 8),
        analytics: prevLabels.analytics,
        createdByName:
          prevLabels.createdByName ??
          (userDisplayName && userDisplayName.trim() ? userDisplayName.trim() : undefined),
      };

      let nextVersion: number;
      if (!draftId) {
        nextVersion = Math.max(1, draftVersion);
      } else if (prevRow) {
        nextVersion = prevBody !== body ? prevRow.version + 1 : prevRow.version;
      } else {
        nextVersion = Math.max(1, draftVersion);
      }

      let createdRow: PromptModuleRow | null = null;
      if (draftId) {
        const row = await api.patch<PromptModuleRow>(`/automation/prompt-modules/${draftId}`, {
          name,
          slug,
          body,
          version: nextVersion,
          labels,
        });
        setDraftVersion(row.version);
      } else {
        createdRow = await api.post<PromptModuleRow>("/automation/prompt-modules", {
          name,
          slug,
          body,
          version: nextVersion,
          labels,
        });
      }
      setEditorOpen(false);
      await onRefresh();
      if (!draftId && createAgentAfterSave && createdRow && onCreateAgentFromPrompt) {
        onCreateAgentFromPrompt(createdRow);
      }
      setCreateAgentAfterSave(false);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteRow = async (id: string) => {
    if (!window.confirm(t("automationPage.promptDeleteConfirm"))) return;
    setLoading(true);
    try {
      await api.delete(`/automation/prompt-modules/${id}`);
      if (draftId === id) setEditorOpen(false);
      await onRefresh();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const duplicateRow = async (row: PromptModuleRow) => {
    const base = slugify(`${row.slug}_copy`);
    let slug = base;
    let n = 2;
    while (prompts.some((p) => p.slug === slug)) {
      slug = `${base}_${n}`;
      n++;
    }
    const lb = parsePromptLabels(row.labels);
    setLoading(true);
    try {
      await api.post("/automation/prompt-modules", {
        name: `${row.name} (copy)`,
        slug,
        body: row.body,
        version: 1,
        labels: { ...lb, history: [] },
      });
      await onRefresh();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  };

  const applyTemplate = (tpl: TemplateDef) => {
    const title = t(`automationPage.promptHub.${tpl.nameKey}`);
    setDraftId(null);
    setDraftName(title);
    setDraftDescription(t(`automationPage.promptHub.${tpl.descKey}`));
    setDraftCategory(tpl.categoryKey);
    setDraftModelHint(tpl.modelHint);
    setDraftBody(tpl.body);
    setDraftStatus("active");
    setDraftSlug(slugify(title));
    setDraftVersion(1);
    setSlugTouched(false);
    setDraftConnectedToolIds([]);
    setPreviewModel((tpl.modelHint ?? "").trim() || "gpt-4o-mini");
    setPreviewProvider(/gemini/i.test(tpl.modelHint ?? "") ? "google_gemini" : "openai");
    setPreviewTemperature(0.7);
    setPreviewMaxTokens(1024);
    setPreviewBaseUrl("https://api.openai.com/v1");
    setCreateAgentAfterSave(false);
    setTemplatesOpen(false);
    setEditorOpen(true);
    setEditorTab("editor");
  };

  const insertAtCursor = (text: string) => {
    const el = bodyRef.current;
    if (!el) {
      setDraftBody((b) => b + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setDraftBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onBodyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      insertAtCursor("  ");
    }
  };

  const improvePrompt = () => {
    setDraftBody((b) => (b.trim() ? b.trimEnd() + IMPROVE_SCAFFOLD : b + IMPROVE_SCAFFOLD.trimStart()));
  };

  const rollbackTo = (entry: PromptHistoryEntry) => {
    if (!window.confirm(t("automationPage.promptHub.historyRollbackConfirm"))) return;
    setDraftBody(entry.body);
    setDraftVersion(entry.version);
  };

  const serverHistory = useMemo(() => {
    if (!draftId) return [];
    const row = prompts.find((p) => p.id === draftId);
    return parsePromptLabels(row?.labels).history ?? [];
  }, [draftId, prompts]);

  const sendPreview = async () => {
    const text = previewInput.trim();
    if (!text || previewBusy) return;
    const resolved = resolveVariables(draftBody, sampleCtx as unknown as Record<string, string>);

    if (!previewLiveMode) {
      const simulated = t("automationPage.promptHub.previewSimulatedReply");
      setPreviewMessages((m) => [
        ...m,
        { role: "user", text },
        {
          role: "assistant",
          text: `${simulated}\n\n---\n${t("automationPage.promptHub.previewResolvedExcerpt")}\n${resolved.slice(0, 600)}${resolved.length > 600 ? "…" : ""}`,
        },
      ]);
      setPreviewInput("");
      return;
    }

    setPreviewError("");
    setPreviewBusy(true);
    const history = previewMessages.map((m) => ({ role: m.role, content: m.text }));
    try {
      const res = await api.post<{
        reply: string;
        usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
        latencyMs: number;
      }>("/automation/prompt-modules/preview", {
        systemPrompt: resolved,
        history,
        userMessage: text,
        provider: previewProvider,
        model: previewModel.trim(),
        temperature: previewTemperature,
        maxTokens: previewMaxTokens,
        apiBaseUrl: previewProvider === "openai" ? previewBaseUrl.trim() || null : null,
        apiKey: previewApiKey.trim() || null,
        promptModuleId: draftId,
        recordMetrics: previewRecordMetrics && Boolean(draftId),
      });
      const meta =
        res.usage != null
          ? `\n\n—\n${t("automationPage.promptHub.previewMeta")}: ${res.usage.totalTokens} tokens · ${res.latencyMs} ms`
          : `\n\n—\n${res.latencyMs} ms`;
      setPreviewMessages((m) => [
        ...m,
        { role: "user", text },
        { role: "assistant", text: `${res.reply}${meta}` },
      ]);
      setPreviewInput("");
      if (previewRecordMetrics && draftId) await onRefresh();
    } catch (e) {
      setPreviewError(e instanceof ApiError ? e.message : t("automationPage.promptHub.previewErrorGeneric"));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const data = JSON.parse(raw) as unknown;
      const rows = Array.isArray(data) ? data : [data];
      setLoading(true);
      for (const item of rows) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name : "";
        const slug = typeof o.slug === "string" ? o.slug : slugify(name);
        const body = typeof o.body === "string" ? o.body : "";
        if (!name?.trim() || !body.trim()) continue;
        await api.post("/automation/prompt-modules", {
          name: name.trim(),
          slug: slug.replace(/[^a-z0-9_]/g, "_"),
          body,
          version: typeof o.version === "number" ? o.version : 1,
          labels: o.labels ?? {},
        });
      }
      await onRefresh();
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const statusBadge = (st: PromptStatus) => {
    const styles: Record<PromptStatus, string> = {
      production: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
      active: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
      test: "bg-amber-500/15 text-amber-800 dark:text-amber-200 ring-amber-500/30",
      draft: "bg-ink-500/15 text-ink-600 dark:text-ink-300 ring-ink-500/25",
    };
    return (
      <span
        className={clsx(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
          styles[st],
        )}
      >
        {t(`automationPage.promptHub.status_${st}`)}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-ink-200/80 bg-gradient-to-br from-brand-500/10 via-white to-violet-500/5 p-6 shadow-sm dark:border-ink-700 dark:from-brand-500/15 dark:via-ink-900 dark:to-violet-950/30">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 left-1/3 h-40 w-40 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-500/20 dark:bg-ink-800/80 dark:text-brand-300">
              <Sparkles className="h-3.5 w-3.5" />
              {t("automationPage.promptHub.badge")}
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
              {t("automationPage.promptHub.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {t("automationPage.promptHub.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white/80 px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm backdrop-blur hover:bg-white dark:border-ink-600 dark:bg-ink-900/80 dark:text-ink-100"
            >
              <BookTemplate className="h-4 w-4 text-violet-500" />
              {t("automationPage.promptHub.templates")}
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white/80 px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-sm backdrop-blur hover:bg-white dark:border-ink-600 dark:bg-ink-900/80 dark:text-ink-100"
            >
              <FileJson className="h-4 w-4 text-sky-500" />
              {t("automationPage.promptHub.import")}
            </button>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" />
              {t("automationPage.promptHub.newPrompt")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-ink-200/80 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-ink-700 dark:bg-ink-900/50">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("automationPage.promptHub.searchPlaceholder")}
              className="w-full rounded-xl border border-ink-200 bg-white py-2.5 pl-10 pr-3 text-sm text-ink-900 shadow-inner dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="appearance-none rounded-xl border border-ink-200 bg-white py-2.5 pl-3 pr-9 text-sm font-medium dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
              >
                <option value="all">{t("automationPage.promptHub.categoryAll")}</option>
                {CATEGORY_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`automationPage.promptHub.category_${id}`)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            </div>
            <div className="relative">
              <input
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder={t("automationPage.promptHub.tagsFilter")}
                list="prompt-hub-tags"
                className="w-40 rounded-xl border border-ink-200 bg-white py-2.5 pl-3 pr-3 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100 sm:w-48"
              />
              <datalist id="prompt-hub-tags">
                {allTags.map((tg) => (
                  <option key={tg} value={tg} />
                ))}
              </datalist>
            </div>
            <div className="ml-auto flex rounded-xl border border-ink-200 p-0.5 dark:border-ink-600">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={clsx(
                  "rounded-lg p-2",
                  view === "grid" ? "bg-brand-600 text-white" : "text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800",
                )}
                aria-label="Grid"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={clsx(
                  "rounded-lg p-2",
                  view === "list" ? "bg-brand-600 text-white" : "text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800",
                )}
                aria-label="List"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 py-16 text-center dark:border-ink-600 dark:bg-ink-900/30">
          <MessageSquare className="mx-auto h-10 w-10 text-ink-400" />
          <p className="mt-3 text-sm font-medium text-ink-700 dark:text-ink-300">{t("automationPage.promptHub.empty")}</p>
          <button
            type="button"
            onClick={openNew}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t("automationPage.promptHub.newPrompt")}
          </button>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const lb = parsePromptLabels(p.labels);
            const usage = countPromptUsage(p.id, agentProfiles);
            const accent = COLOR_ACCENTS[lb.color ?? "violet"] ?? COLOR_ACCENTS.violet;
            const execs = lb.analytics?.executions ?? usage;
            return (
              <div
                key={p.id}
                className={clsx(
                  "group relative overflow-hidden rounded-2xl border border-ink-200/80 bg-gradient-to-br p-[1px] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl dark:border-ink-700",
                  "from-white/0 to-white/0 dark:from-ink-900/0",
                )}
              >
                <div
                  className={clsx(
                    "h-full rounded-2xl bg-gradient-to-br p-4 backdrop-blur-md dark:from-ink-900/90 dark:to-ink-950/90",
                    "bg-white/80",
                    accent,
                    "ring-1 ring-inset ring-white/40 dark:ring-ink-700/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/90 shadow-sm ring-1 ring-ink-100 dark:bg-ink-800 dark:ring-ink-600">
                        <HubIcon name={lb.icon ?? "Sparkles"} className="h-5 w-5 text-brand-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-ink-900 dark:text-ink-50">{p.name}</h3>
                        <p className="truncate text-xs text-ink-500">{lb.description || p.slug}</p>
                      </div>
                    </div>
                    {statusBadge(lb.status ?? "active")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <span className="rounded-md bg-ink-900/5 px-2 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-white/5 dark:text-ink-400">
                      {t(`automationPage.promptHub.category_${lb.category ?? "general"}`)}
                    </span>
                    {(lb.tags ?? []).slice(0, 4).map((tg) => (
                      <span
                        key={tg}
                        className="rounded-md bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300"
                      >
                        {tg}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                    <span className="font-medium text-ink-700 dark:text-ink-300">
                      {lb.modelHint || "—"}
                    </span>
                    <span>·</span>
                    <span>
                      {execs} {t("automationPage.promptHub.execLabel")}
                    </span>
                    {p.updatedAt ? (
                      <>
                        <span>·</span>
                        <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {t("automationPage.promptHub.cardCreator")}: {lb.createdByName ?? "—"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-200/60 pt-3 dark:border-ink-700/60">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white"
                    >
                      {t("automationPage.kbEdit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateRow(p)}
                      className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                    >
                      {t("automationPage.promptHub.duplicate")}
                    </button>
                    <button
                      type="button"
                      onClick={onNavigateAgents}
                      className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300"
                    >
                      {t("automationPage.promptHub.use")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => {
            const lb = parsePromptLabels(p.labels);
            const usage = countPromptUsage(p.id, agentProfiles);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white/80 px-4 py-3 dark:border-ink-700 dark:bg-ink-900/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <HubIcon name={lb.icon ?? "Sparkles"} className="h-5 w-5 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900 dark:text-ink-50">{p.name}</span>
                      {statusBadge(lb.status ?? "active")}
                      <code className="text-xs text-ink-500">{p.slug}</code>
                    </div>
                    <p className="text-xs text-ink-500">
                      {lb.modelHint || "—"} · {lb.analytics?.executions ?? usage}{" "}
                      {t("automationPage.promptHub.execLabel")}
                      {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="text-xs font-semibold text-brand-600"
                  >
                    {t("automationPage.kbEdit")}
                  </button>
                  <button type="button" onClick={() => void duplicateRow(p)} className="text-xs font-semibold">
                    {t("automationPage.promptHub.duplicate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteRow(p.id)}
                    className="text-xs font-semibold text-red-600"
                  >
                    {t("automationPage.kbDelete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)}
      />

      {templatesOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-200 px-5 py-4 dark:border-ink-700">
              <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                {t("automationPage.promptHub.templatesTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setTemplatesOpen(false)}
                className="rounded-lg p-2 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-4rem)] overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {BUILT_IN_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="rounded-xl border border-ink-200 bg-ink-50/50 p-4 text-left transition hover:border-brand-500/40 hover:bg-brand-500/5 dark:border-ink-700 dark:bg-ink-950/50"
                  >
                    <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">
                      {t(`automationPage.promptHub.category_${tpl.categoryKey}`)}
                    </p>
                    <p className="mt-1 font-semibold text-ink-900 dark:text-ink-50">
                      {t(`automationPage.promptHub.${tpl.nameKey}`)}
                    </p>
                    <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                      {t(`automationPage.promptHub.${tpl.descKey}`)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-ink-950/70 p-3 backdrop-blur-md sm:p-6">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-950">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-700">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                  {draftId ? t("automationPage.promptEditTitle") : t("automationPage.promptNewTitle")}
                </p>
                <h3 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("automationPage.promptHub.editorTitle")}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={improvePrompt}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-800 dark:border-violet-600 dark:text-violet-200"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {t("automationPage.promptHub.improve")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void saveDraft()}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("automationPage.promptSave")}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="w-full shrink-0 border-b border-ink-200 p-4 dark:border-ink-700 lg:w-72 lg:border-b-0 lg:border-r">
                <label className="text-xs font-medium text-ink-600 dark:text-ink-400">{t("automationPage.promptName")}</label>
                <input
                  value={draftName}
                  onChange={(e) => {
                    setDraftName(e.target.value);
                    if (!slugTouched) setDraftSlug(slugify(e.target.value));
                  }}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptSlug")}
                </label>
                <input
                  value={draftSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setDraftSlug(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-sm dark:border-ink-600 dark:bg-ink-900"
                />
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptHub.fieldCategory")}
                </label>
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                >
                  {CATEGORY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(`automationPage.promptHub.category_${id}`)}
                    </option>
                  ))}
                </select>
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptHub.fieldTags")}
                </label>
                <input
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="hotel, whatsapp, ia"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptHub.fieldStatus")}
                </label>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as PromptStatus)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {t(`automationPage.promptHub.status_${s}`)}
                    </option>
                  ))}
                </select>
                {!draftId ? (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-ink-600 dark:text-ink-400">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-ink-300"
                      checked={createAgentAfterSave}
                      onChange={(e) => setCreateAgentAfterSave(e.target.checked)}
                    />
                    <span>{t("automationPage.promptHub.createAgentAfterSave")}</span>
                  </label>
                ) : null}
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptHub.fieldModel")}
                </label>
                <input
                  value={draftModelHint}
                  onChange={(e) => {
                    setDraftModelHint(e.target.value);
                    setPreviewModel(e.target.value.trim() || "gpt-4o-mini");
                  }}
                  placeholder="gpt-4o"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
                <p className="mt-1 text-[10px] text-ink-500">{t("automationPage.promptHub.fieldModelLlmTabHint")}</p>
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptHub.fieldDescription")}
                </label>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-ink-600 dark:text-ink-400">
                      {t("automationPage.promptHub.fieldIcon")}
                    </label>
                    <input
                      value={draftIcon}
                      onChange={(e) => setDraftIcon(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-600 dark:text-ink-400">
                      {t("automationPage.promptHub.fieldColor")}
                    </label>
                    <select
                      value={draftColor}
                      onChange={(e) => setDraftColor(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-900"
                    >
                      {Object.keys(COLOR_ACCENTS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="mt-3 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("automationPage.promptVersion")}
                </label>
                <input
                  type="number"
                  min={1}
                  value={draftVersion}
                  onChange={(e) => setDraftVersion(Number(e.target.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
              </div>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap gap-1 border-b border-ink-200 px-2 py-2 dark:border-ink-700">
                  {(
                    [
                      ["editor", t("automationPage.promptHub.tabEditor"), Sparkles],
                      ["preview", t("automationPage.promptHub.tabPreview"), MessageSquare],
                      ["variables", t("automationPage.promptHub.tabVariables"), Tag],
                      ["tools", t("automationPage.promptHub.tabTools"), Wrench],
                      ["history", t("automationPage.promptHub.tabHistory"), History],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditorTab(key)}
                      className={clsx(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                        editorTab === key
                          ? "bg-brand-600 text-white"
                          : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {editorTab === "editor" ? (
                    <div className="space-y-3">
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
                                {t("automationPage.promptHub.editorPromptBuilderIntro")}
                              </p>
                            </div>
                            <div className="inline-flex rounded-lg border border-ink-200/80 bg-white/90 p-0.5 shadow-sm dark:border-ink-600 dark:bg-ink-950/80">
                              <button
                                type="button"
                                onClick={() => setPromptHubBuilderSubTab("builder")}
                                className={clsx(
                                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                                  promptHubBuilderSubTab === "builder"
                                    ? "bg-brand-600 text-white shadow-sm"
                                    : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
                                )}
                              >
                                {t("automationPage.promptBuilderTabBuilder")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPromptHubBuilderSubTab("merged")}
                                className={clsx(
                                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                                  promptHubBuilderSubTab === "merged"
                                    ? "bg-brand-600 text-white shadow-sm"
                                    : "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
                                )}
                              >
                                {t("automationPage.promptBuilderTabMerged")}
                              </button>
                            </div>
                          </div>
                        </div>

                        {promptHubBuilderSubTab === "merged" ? (
                          <div className="mt-4 space-y-2">
                            <p className="text-xs font-medium text-ink-700 dark:text-ink-300">
                              {t("automationPage.promptMergedTitle")}
                            </p>
                            <p className="text-[11px] text-ink-500">{t("automationPage.promptHub.mergedModuleHelp")}</p>
                            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-ink-200 bg-ink-950/90 p-3 font-mono text-[11px] leading-relaxed text-ink-100 dark:border-ink-700">
                              {draftBody.trim() || t("automationPage.agentSystemInstructionsPh")}
                            </pre>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-3">
                            <div className="flex flex-wrap gap-2">
                              {PROMPT_BLOCK_SNIPPETS.map((b) => (
                                <button
                                  key={b.key}
                                  type="button"
                                  onClick={() => insertAtCursor(`\n${b.heading}`)}
                                  className="rounded-full border border-ink-200 bg-ink-50 px-2.5 py-1 text-[11px] font-medium dark:border-ink-600 dark:bg-ink-900"
                                >
                                  {t(`automationPage.promptHub.block_${b.key}`)}
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {VARIABLE_SNIPPETS.map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => insertAtCursor(v)}
                                  className="rounded-md bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] text-sky-800 dark:text-sky-200"
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                            <textarea
                              ref={bodyRef}
                              value={draftBody}
                              onChange={(e) => setDraftBody(e.target.value)}
                              onKeyDown={onBodyKeyDown}
                              spellCheck={false}
                              className="min-h-[320px] w-full resize-y rounded-xl border border-ink-200 bg-ink-950 px-4 py-3 font-mono text-sm leading-relaxed text-ink-100 shadow-inner ring-1 ring-inset ring-white/10 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700"
                              placeholder={t("automationPage.agentSystemInstructionsPh")}
                            />
                            <p className="text-[11px] text-ink-500">{t("automationPage.promptHub.editorHint")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {editorTab === "preview" ? (
                    <div className="grid gap-4 lg:grid-cols-5">
                      <div className="space-y-3 lg:col-span-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink-700 dark:text-ink-300">
                            {t("automationPage.promptHub.previewMode")}
                          </span>
                          <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                            <input
                              type="radio"
                              checked={previewLiveMode}
                              onChange={() => setPreviewLiveMode(true)}
                            />
                            {t("automationPage.promptHub.previewLive")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                            <input
                              type="radio"
                              checked={!previewLiveMode}
                              onChange={() => setPreviewLiveMode(false)}
                            />
                            {t("automationPage.promptHub.previewSimulated")}
                          </label>
                        </div>
                        {previewLiveMode ? (
                          <div className="space-y-2 rounded-xl border border-ink-200 bg-white/80 p-3 dark:border-ink-700 dark:bg-ink-900/40">
                            <p className="text-[11px] text-ink-500">
                              {previewProvider === "openai"
                                ? previewOptions?.hasPlatformOpenAiKey
                                  ? t("automationPage.promptHub.previewPlatformOpenAi")
                                  : t("automationPage.promptHub.previewPlatformOpenAiOff")
                                : previewOptions?.hasPlatformGeminiKey
                                  ? t("automationPage.promptHub.previewPlatformGemini")
                                  : t("automationPage.promptHub.previewPlatformGeminiOff")}
                            </p>
                            <label className="block text-[11px] font-medium text-ink-600 dark:text-ink-400">
                              {t("automationPage.promptHub.previewProvider")}
                              <select
                                value={previewProvider}
                                onChange={(e) => {
                                  const p = e.target.value as "openai" | "google_gemini";
                                  setPreviewProvider(p);
                                  if (p === "google_gemini") {
                                    setPreviewModel((m) => (/gemini/i.test(m) ? m : "gemini-1.5-flash"));
                                  } else {
                                    setPreviewModel((m) => (/^gpt-/i.test(m) ? m : "gpt-4o-mini"));
                                  }
                                }}
                                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-900"
                              >
                                <option value="openai">OpenAI / compatível</option>
                                <option value="google_gemini">Google Gemini</option>
                              </select>
                            </label>
                            <label className="block text-[11px] font-medium text-ink-600 dark:text-ink-400">
                              {t("automationPage.promptHub.previewModel")}
                              <input
                                value={previewModel}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPreviewModel(v);
                                  setDraftModelHint(v);
                                }}
                                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-900"
                              />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-[11px] font-medium text-ink-600 dark:text-ink-400">
                                Temp.
                                <input
                                  type="number"
                                  step={0.1}
                                  min={0}
                                  max={2}
                                  value={previewTemperature}
                                  onChange={(e) => setPreviewTemperature(Number(e.target.value))}
                                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                />
                              </label>
                              <label className="text-[11px] font-medium text-ink-600 dark:text-ink-400">
                                Max tokens
                                <input
                                  type="number"
                                  min={16}
                                  max={8192}
                                  value={previewMaxTokens}
                                  onChange={(e) => setPreviewMaxTokens(Number(e.target.value) || 1024)}
                                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                                />
                              </label>
                            </div>
                            {previewProvider === "openai" ? (
                              <label className="block text-[11px] font-medium text-ink-600 dark:text-ink-400">
                                API base URL
                                <input
                                  value={previewBaseUrl}
                                  onChange={(e) => setPreviewBaseUrl(e.target.value)}
                                  placeholder="https://api.openai.com/v1"
                                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-900"
                                />
                              </label>
                            ) : null}
                            <label className="block text-[11px] font-medium text-ink-600 dark:text-ink-400">
                              {t("automationPage.promptHub.previewApiKey")}
                              <input
                                type="password"
                                autoComplete="off"
                                value={previewApiKey}
                                onChange={(e) => setPreviewApiKey(e.target.value)}
                                placeholder="sk-…"
                                className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-xs dark:border-ink-600 dark:bg-ink-900"
                              />
                            </label>
                            {draftId ? (
                              <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                                <input
                                  type="checkbox"
                                  checked={previewRecordMetrics}
                                  onChange={(e) => setPreviewRecordMetrics(e.target.checked)}
                                />
                                {t("automationPage.promptHub.previewRecordMetrics")}
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        <p className="text-xs font-semibold text-ink-700 dark:text-ink-300">
                          {t("automationPage.promptHub.previewContext")}
                        </p>
                        {(Object.keys(sampleCtx) as Array<keyof typeof sampleCtx>).map((k) => (
                          <label key={k} className="block text-[11px]">
                            <span className="text-ink-500">{k}</span>
                            <input
                              value={sampleCtx[k]}
                              onChange={(e) => setSampleCtx((s) => ({ ...s, [k]: e.target.value }))}
                              className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-900"
                            />
                          </label>
                        ))}
                      </div>
                      <div className="flex min-h-[360px] flex-col rounded-xl border border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900/50 lg:col-span-3">
                        <div className="border-b border-ink-200 px-3 py-2 text-xs font-medium dark:border-ink-700">
                          {t("automationPage.promptHub.previewChat")}
                        </div>
                        {previewError ? (
                          <div className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
                            {previewError}
                          </div>
                        ) : null}
                        <div className="flex-1 space-y-3 overflow-y-auto p-3">
                          {previewMessages.length === 0 ? (
                            <p className="text-xs text-ink-500">{t("automationPage.promptHub.previewEmpty")}</p>
                          ) : (
                            previewMessages.map((m, i) => (
                              <div
                                key={i}
                                className={clsx(
                                  "max-w-[95%] rounded-2xl px-3 py-2 text-sm",
                                  m.role === "user"
                                    ? "ml-auto bg-brand-600 text-white"
                                    : "mr-auto border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-950",
                                )}
                              >
                                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{m.text}</pre>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="flex gap-2 border-t border-ink-200 p-2 dark:border-ink-700">
                          <input
                            value={previewInput}
                            onChange={(e) => setPreviewInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void sendPreview();
                              }
                            }}
                            disabled={previewBusy}
                            placeholder={t("automationPage.promptHub.previewInputPh")}
                            className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900"
                          />
                          <button
                            type="button"
                            disabled={previewBusy}
                            onClick={() => void sendPreview()}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-white disabled:opacity-50"
                          >
                            {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {editorTab === "variables" ? (
                    <div className="space-y-3">
                      <p className="text-sm text-ink-600 dark:text-ink-400">{t("automationPage.promptHub.variablesIntro")}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {VARIABLE_SNIPPETS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => insertAtCursor(v)}
                            className="flex items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-500/40 dark:border-ink-700 dark:bg-ink-950"
                          >
                            <code className="text-xs text-sky-700 dark:text-sky-300">{v}</code>
                            <Copy className="h-4 w-4 text-ink-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {editorTab === "tools" ? (
                    <div className="space-y-3">
                      <p className="text-sm text-ink-600 dark:text-ink-400">{t("automationPage.promptHub.toolsIntro")}</p>
                      <button
                        type="button"
                        onClick={onOpenToolsTab}
                        className="text-xs font-semibold text-brand-600 hover:underline"
                      >
                        {t("automationPage.agentNativeToolsTabLink")}
                      </button>
                      <ul className="space-y-2">
                        {tools.map((tool) => (
                          <li key={tool.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700">
                              <input
                                type="checkbox"
                                checked={draftConnectedToolIds.includes(tool.id)}
                                onChange={(e) => {
                                  setDraftConnectedToolIds((ids) =>
                                    e.target.checked ? [...ids, tool.id] : ids.filter((x) => x !== tool.id),
                                  );
                                }}
                              />
                              <span className="text-sm font-medium">{tool.name}</span>
                              <span className="text-xs text-ink-500">{tool.toolType}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {editorTab === "history" ? (
                    <div className="space-y-3">
                      <p className="text-sm text-ink-600 dark:text-ink-400">{t("automationPage.promptHub.historyIntro")}</p>
                      {serverHistory.length === 0 ? (
                        <p className="text-xs text-ink-500">{t("automationPage.promptHub.historyEmpty")}</p>
                      ) : (
                        <ul className="space-y-2">
                          {serverHistory.map((h) => (
                            <li
                              key={h.at}
                              className="rounded-xl border border-ink-200 p-3 dark:border-ink-700"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold">
                                  v{h.version} · {new Date(h.at).toLocaleString()}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => rollbackTo(h)}
                                  className="text-xs font-semibold text-brand-600"
                                >
                                  {t("automationPage.promptHub.rollback")}
                                </button>
                              </div>
                              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-ink-600 dark:text-ink-400">
                                {h.body.slice(0, 400)}
                                {h.body.length > 400 ? "…" : ""}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 bg-ink-50/80 px-4 py-2 text-xs text-ink-500 dark:border-ink-700 dark:bg-ink-900/80">
              <span>
                {t("automationPage.promptHub.footerCreator")}: {userDisplayName ?? "—"}
              </span>
              {draftId ? (
                <button
                  type="button"
                  onClick={() => void deleteRow(draftId)}
                  className="font-semibold text-red-600"
                >
                  {t("automationPage.kbDelete")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
