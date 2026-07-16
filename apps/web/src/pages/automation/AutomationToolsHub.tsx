import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import clsx from "clsx";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  ChevronRight,
  Download,
  Heart,
  LayoutGrid,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Star,
  Terminal,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AutomationCustomToolRow, AutomationToolsTranslate, ToolPresetMeta } from "./automationToolTypes";

const FAV_KEY = "oc_automation_tool_favorites_v1";

type HubTab = "marketplace" | "mine" | "create";

type CredentialEditorProps = {
  tool: AutomationCustomToolRow;
  t: AutomationToolsTranslate;
  onSave: (patch: Record<string, unknown>) => void;
};

function MarketplaceIcon({ name }: { name: string }) {
  const Cmp =
    (LucideIcons as unknown as Record<string, LucideIcon>)[name] ?? LucideIcons.Box;
  return <Cmp className="h-6 w-6" strokeWidth={1.5} />;
}

const VARIABLE_SNIPPETS = [
  "{{contact.name}}",
  "{{conversation.id}}",
  "{{message}}",
  "{{agent.name}}",
  "{{custom.variable}}",
];

const MARKETPLACE_FILTER_KEYS = [
  "ALL",
  "EMAIL",
  "MESSAGING",
  "CRM",
  "PAYMENTS",
  "PRODUCTIVITY",
  "LLM",
  "DATA",
  "AUTOMATION",
] as const;

function effectiveMarketCategory(p: ToolPresetMeta): string | null {
  if (p.marketplace?.category) return p.marketplace.category;
  if (p.category === "EMAIL_API") return "EMAIL";
  if (p.category === "GOOGLE_CALENDAR") return "PRODUCTIVITY";
  if (p.category === "ELEVENLABS" || p.category === "MCP_NATIVE" || p.category === "HTTP_CUSTOM") return "AUTOMATION";
  if (p.category === "INTEGRATION_MARKETPLACE") return "AUTOMATION";
  return null;
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveFavorites(next: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
}

export function AutomationToolsHub({
  t,
  loading,
  tools,
  toolPresets,
  installToolPreset,
  presetInstalled,
  deleteCustomToolRow,
  saveToolConfigPatch,
  patchTool,
  editingToolId,
  setEditingToolId,
  CredentialEditor,
  onToolsUpdated,
}: {
  t: AutomationToolsTranslate;
  loading: boolean;
  tools: AutomationCustomToolRow[];
  toolPresets: ToolPresetMeta[];
  installToolPreset: (presetKey: string) => Promise<void>;
  presetInstalled: (presetKey: string) => boolean;
  deleteCustomToolRow: (toolId: string) => Promise<void>;
  saveToolConfigPatch: (toolId: string, patch: Record<string, unknown>) => Promise<void>;
  patchTool: (toolId: string, patch: Record<string, unknown>) => Promise<void>;
  editingToolId: string | null;
  setEditingToolId: (id: string | null) => void;
  CredentialEditor: ComponentType<CredentialEditorProps>;
  onToolsUpdated: () => Promise<void>;
}) {
  const [hubTab, setHubTab] = useState<HubTab>("marketplace");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<(typeof MARKETPLACE_FILTER_KEYS)[number]>("ALL");
  const [marketFilter, setMarketFilter] = useState<"all" | "favorites" | "installed" | "popular">("all");
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());

  const [drawerTool, setDrawerTool] = useState<AutomationCustomToolRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<"test" | "logs">("test");
  const [testBodyJson, setTestBodyJson] = useState("{}");
  const [testContextJson, setTestContextJson] = useState(
    JSON.stringify(
      {
        contact: { name: "Cliente exemplo" },
        conversation: { id: "00000000-0000-0000-0000-000000000000" },
        message: "Olá",
        agent: { name: "Assistente" },
        custom: { variable: "demo" },
      },
      null,
      2,
    ),
  );
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  const [executions, setExecutions] = useState<Array<Record<string, unknown>>>([]);
  const [execLoading, setExecLoading] = useState(false);

  const [createType, setCreateType] = useState("HTTP_API");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createCategory, setCreateCategory] = useState("AUTOMATION");
  const [createIcon, setCreateIcon] = useState("Globe");
  const [createColor, setCreateColor] = useState("cyan");
  const [createConfigJson, setCreateConfigJson] = useState(() =>
    JSON.stringify(
      {
        presetKey: null,
        executor: "http_client",
        baseUrl: "https://httpbin.org",
        httpMethod: "GET",
        httpPath: "/get",
        authType: "none",
        defaultHeaders: {},
        defaultQuery: {},
        bodyTemplate: {},
      },
      null,
      2,
    ),
  );
  const [createParamsJson, setCreateParamsJson] = useState("{}");
  const [createSaving, setCreateSaving] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const [editTool, setEditTool] = useState<AutomationCustomToolRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editCategory, setEditCategory] = useState("AUTOMATION");
  const [editIcon, setEditIcon] = useState("Globe");
  const [editColor, setEditColor] = useState("cyan");
  const [editParamsJson, setEditParamsJson] = useState("{}");
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  const openEditTool = (tool: AutomationCustomToolRow) => {
    const c = (tool.config ?? {}) as Record<string, unknown>;
    const ui = (c.ui ?? {}) as Record<string, unknown>;
    setEditTool(tool);
    setEditErr("");
    setEditName(tool.name ?? "");
    setEditDesc(tool.description ?? "");
    setEditTags((tool.tags ?? []).join(", "));
    setEditCategory(String(ui.category ?? "AUTOMATION"));
    setEditIcon(String(ui.icon ?? "Globe"));
    setEditColor(String(ui.accent ?? "cyan"));
    setEditParamsJson(JSON.stringify(tool.parametersSchema ?? {}, null, 2));
  };

  const saveToolEdits = async () => {
    if (!editTool) return;
    setEditErr("");
    if (!editName.trim() || !editDesc.trim()) {
      setEditErr(t("automationPage.toolsCreateValidation"));
      return;
    }
    let parametersSchema: Record<string, unknown>;
    try {
      parametersSchema = JSON.parse(editParamsJson || "{}") as Record<string, unknown>;
    } catch {
      setEditErr(t("automationPage.toolsCreateParamsInvalid"));
      return;
    }
    const tagsArr = editTags
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 32);

    setEditSaving(true);
    try {
      await patchTool(editTool.id, {
        name: editName.trim(),
        description: editDesc.trim(),
        tags: tagsArr,
        parametersSchema,
        config: {
          ui: {
            category: editCategory,
            icon: editIcon,
            accent: editColor,
          },
        },
      });
      await onToolsUpdated();
      setEditTool(null);
    } catch {
      setEditErr(t("automationPage.loadError"));
    } finally {
      setEditSaving(false);
    }
  };

  const toggleFavorite = (presetKey: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(presetKey)) next.delete(presetKey);
      else next.add(presetKey);
      saveFavorites(next);
      return next;
    });
  };

  const allMarketplacePresets = useMemo(() => {
    return [...toolPresets].sort((a, b) => {
      const pa = a.marketplace?.popularity ?? 50;
      const pb = b.marketplace?.popularity ?? 50;
      return pb - pa;
    });
  }, [toolPresets]);

  const filteredPresets = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allMarketplacePresets.filter((p) => {
      if (catFilter !== "ALL" && effectiveMarketCategory(p) !== catFilter) return false;
      if (marketFilter === "favorites" && !favorites.has(p.presetKey)) return false;
      if (marketFilter === "installed" && !presetInstalled(p.presetKey)) return false;
      if (q) {
        const blob = `${p.name} ${p.description} ${p.toolType} ${p.category}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    if (marketFilter === "popular") {
      list = list.slice(0, 18);
    }
    return list;
  }, [allMarketplacePresets, catFilter, marketFilter, favorites, presetInstalled, search]);

  const loadExecutions = useCallback(async (toolId: string) => {
    setExecLoading(true);
    try {
      const res = await api.get<{ data: Array<Record<string, unknown>> }>(
        `/automation/custom-tools/${toolId}/executions?limit=50`,
      );
      setExecutions(res.data ?? []);
    } catch {
      setExecutions([]);
    } finally {
      setExecLoading(false);
    }
  }, []);

  useEffect(() => {
    if (drawerTool && drawerTab === "logs") void loadExecutions(drawerTool.id);
  }, [drawerTool, drawerTab, loadExecutions]);

  const runTest = async () => {
    if (!drawerTool) return;
    let body: Record<string, unknown> = {};
    let sampleContext: Record<string, unknown> = {};
    try {
      body = JSON.parse(testBodyJson || "{}") as Record<string, unknown>;
    } catch {
      setTestResult({ error: "Invalid JSON in request body" });
      return;
    }
    try {
      sampleContext = JSON.parse(testContextJson || "{}") as Record<string, unknown>;
    } catch {
      setTestResult({ error: "Invalid JSON in sample context" });
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    try {
      const httpBody = { ...body };
      const pathParams = httpBody.pathParams;
      const query = httpBody.query;
      const headersPayload = httpBody.headers;
      delete httpBody.pathParams;
      delete httpBody.query;
      delete httpBody.headers;
      const res = await api.post<Record<string, unknown>>(`/automation/custom-tools/${drawerTool.id}/test`, {
        body: httpBody,
        sampleContext,
        ...(pathParams && typeof pathParams === "object" ? { pathParams } : {}),
        ...(query && typeof query === "object" ? { query } : {}),
        ...(headersPayload && typeof headersPayload === "object" ? { headers: headersPayload } : {}),
      });
      setTestResult(res);
      await onToolsUpdated();
      if (drawerTab === "logs") void loadExecutions(drawerTool.id);
    } catch (e) {
      setTestResult({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setTestRunning(false);
    }
  };

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(executions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tool-logs-${drawerTool?.id ?? "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveNewTool = async () => {
    setCreateErr("");
    if (!createName.trim() || !createDesc.trim()) {
      setCreateErr(t("automationPage.toolsCreateValidation"));
      return;
    }
    let config: Record<string, unknown>;
    let parametersSchema: Record<string, unknown>;
    try {
      config = JSON.parse(createConfigJson) as Record<string, unknown>;
    } catch {
      setCreateErr(t("automationPage.toolsCreateConfigInvalid"));
      return;
    }
    try {
      parametersSchema = JSON.parse(createParamsJson) as Record<string, unknown>;
    } catch {
      setCreateErr(t("automationPage.toolsCreateParamsInvalid"));
      return;
    }
    config.ui = {
      category: createCategory,
      icon: createIcon,
      accent: createColor,
    };
    setCreateSaving(true);
    try {
      await api.post("/automation/custom-tools", {
        name: createName.trim(),
        description: createDesc.trim(),
        toolType: createType,
        config,
        parametersSchema,
        isActive: true,
        tags: [createCategory.toLowerCase()],
      });
      setCreateName("");
      setCreateDesc("");
      await onToolsUpdated();
      setHubTab("mine");
    } catch {
      setCreateErr(t("automationPage.loadError"));
    } finally {
      setCreateSaving(false);
    }
  };

  const glass = "backdrop-blur-md bg-white/70 dark:bg-ink-950/55 border border-white/20 dark:border-ink-700/60 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]";

  return (
    <div className="space-y-8">
      <div
        className={clsx(
          "relative overflow-hidden rounded-2xl border border-ink-200/80 p-6 dark:border-ink-800/80",
          "bg-gradient-to-br from-brand-500/10 via-transparent to-violet-600/10 dark:from-brand-600/15 dark:to-violet-900/20",
        )}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/10" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
              <Sparkles className="h-4 w-4" />
              {t("automationPage.toolsHubBadge")}
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50 md:text-2xl">
              {t("automationPage.toolsHubTitle")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {t("automationPage.toolsHubSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHubTab("create")}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-500"
            >
              <Plus className="h-4 w-4" />
              {t("automationPage.toolsHubNewTool")}
            </button>
          </div>
        </div>

        <div className={clsx("relative mt-6 flex flex-wrap gap-1 rounded-xl p-1", glass)}>
          {(
            [
              { id: "marketplace" as const, label: t("automationPage.toolsTabMarketplace"), icon: LayoutGrid },
              { id: "mine" as const, label: t("automationPage.toolsTabMine"), icon: Wrench },
              { id: "create" as const, label: t("automationPage.toolsTabCreate"), icon: Terminal },
            ] as const
          ).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setHubTab(x.id)}
              className={clsx(
                "inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all sm:flex-none sm:text-sm",
                hubTab === x.id
                  ? "bg-white text-brand-700 shadow-md dark:bg-ink-800 dark:text-brand-300"
                  : "text-ink-600 hover:bg-white/50 dark:text-ink-400 dark:hover:bg-ink-800/50",
              )}
            >
              <x.icon className="h-4 w-4 opacity-80" />
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {hubTab === "marketplace" ? (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("automationPage.toolsSearchPlaceholder")}
                className="w-full rounded-xl border border-ink-200/80 bg-white/80 py-2.5 pl-10 pr-4 text-sm shadow-sm backdrop-blur dark:border-ink-700 dark:bg-ink-900/60 dark:text-ink-100"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "all" as const, label: t("automationPage.toolsFilterAll"), icon: LayoutGrid },
                  { id: "popular" as const, label: t("automationPage.toolsFilterPopular"), icon: Star },
                  { id: "favorites" as const, label: t("automationPage.toolsFilterFavorites"), icon: Heart },
                  { id: "installed" as const, label: t("automationPage.toolsFilterInstalled"), icon: Download },
                ] as const
              ).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setMarketFilter(x.id)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    marketFilter === x.id
                      ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/50 dark:text-brand-200"
                      : "border-ink-200 bg-white/60 text-ink-600 hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400",
                  )}
                >
                  <x.icon className="h-3.5 w-3.5" />
                  {x.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {MARKETPLACE_FILTER_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  catFilter === c
                    ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
                    : "bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:hover:bg-ink-700",
                )}
              >
                {c === "ALL" ? t("automationPage.toolsCategoryAll") : t(`automationPage.toolsMarketCat_${c}`)}
              </button>
            ))}
          </div>

          {loading && filteredPresets.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800/80" />
              ))}
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className={clsx("flex flex-col items-center justify-center rounded-2xl py-16 text-center", glass)}>
              <BookOpen className="h-10 w-10 text-ink-400" />
              <p className="mt-4 text-sm font-medium text-ink-700 dark:text-ink-300">{t("automationPage.toolsEmptyMarketplace")}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredPresets.map((pr) => {
                const installed = presetInstalled(pr.presetKey);
                const mk = pr.marketplace;
                const effCat = effectiveMarketCategory(pr);
                const iconName = mk?.icon ?? "Puzzle";
                return (
                  <div
                    key={pr.presetKey}
                    className={clsx(
                      "group relative overflow-hidden rounded-2xl border border-ink-200/60 p-5 transition duration-300",
                      "hover:-translate-y-0.5 hover:border-brand-500/30 hover:shadow-lg hover:shadow-brand-500/10",
                      "dark:border-ink-700/80 dark:hover:border-brand-500/25",
                      glass,
                    )}
                  >
                    <div
                      className={clsx(
                        "pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100",
                        mk?.accent ? `bg-gradient-to-br ${mk.accent}` : "bg-gradient-to-br from-brand-500/10 to-violet-600/5",
                      )}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-500/20">
                        <MarketplaceIcon name={iconName} />
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(pr.presetKey)}
                        className={clsx(
                          "rounded-lg p-1.5 transition",
                          favorites.has(pr.presetKey)
                            ? "text-rose-500"
                            : "text-ink-400 hover:bg-white/50 dark:hover:bg-ink-800/50",
                        )}
                        title={t("automationPage.toolsFavorite")}
                      >
                        <Heart className={clsx("h-4 w-4", favorites.has(pr.presetKey) && "fill-current")} />
                      </button>
                    </div>
                    <div className="relative mt-4">
                      <h3 className="font-semibold text-ink-900 dark:text-ink-50">{pr.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{pr.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600 dark:bg-ink-800 dark:text-ink-400">
                          {effCat ? t(`automationPage.toolsMarketCat_${effCat}`) : pr.category}
                        </span>
                        <span className="text-[10px] text-ink-400">{pr.toolType}</span>
                        {installed ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {t("automationPage.toolInstalled")}
                          </span>
                        ) : (
                          <span className="rounded-full bg-ink-500/10 px-2 py-0.5 text-[10px] font-medium text-ink-500">
                            {t("automationPage.toolsStatusAvailable")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="relative mt-4 flex items-center justify-between gap-2">
                      {installed ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("automationPage.toolInstalled")}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void installToolPreset(pr.presetKey)}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
                        >
                          {t("automationPage.toolInstall")}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setHubTab("mine")}
                        className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t("automationPage.toolsViewMine")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {hubTab === "mine" ? (
        <div className="space-y-4">
          {tools.length === 0 ? (
            <div className={clsx("rounded-2xl py-16 text-center", glass)}>
              <Wrench className="mx-auto h-10 w-10 text-ink-400" />
              <p className="mt-4 text-sm text-ink-600 dark:text-ink-400">{t("automationPage.toolsEmptyMine")}</p>
              <button
                type="button"
                onClick={() => setHubTab("marketplace")}
                className="mt-4 text-sm font-semibold text-brand-600 dark:text-brand-400"
              >
                {t("automationPage.toolsOpenMarketplace")}
              </button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {tools.map((tool) => {
                const last = tool.lastExecutedAt ? new Date(tool.lastExecutedAt).toLocaleString() : "—";
                const calls = tool.executionCount ?? 0;
                const avg = tool.avgDurationMs != null ? `${Math.round(tool.avgDurationMs)} ms` : "—";
                const canTest = tool.toolType === "HTTP_API" || tool.toolType === "WEBHOOK";
                const isHttpCustom = tool.toolType === "HTTP_API_CUSTOM";
                return (
                  <div
                    key={tool.id}
                    className={clsx(
                      "rounded-2xl border border-ink-200/70 p-5 transition hover:border-brand-500/25 dark:border-ink-700/80",
                      glass,
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink-900 dark:text-ink-50">{tool.name}</h3>
                          <span
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                              tool.isActive
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-500/15 text-amber-800 dark:text-amber-200",
                            )}
                          >
                            {tool.isActive ? t("automationPage.toolsOnline") : t("automationPage.toolsOffline")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-500">{tool.toolType}</p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
                        <input
                          type="checkbox"
                          checked={tool.isActive}
                          onChange={(e) => void patchTool(tool.id, { isActive: e.target.checked })}
                        />
                        {t("automationPage.toolsActiveToggle")}
                      </label>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                      <div className="rounded-lg bg-white/50 p-2 dark:bg-ink-900/40">
                        <p className="text-[10px] font-semibold uppercase text-ink-500">{t("automationPage.toolsLastRun")}</p>
                        <p className="mt-0.5 font-medium text-ink-800 dark:text-ink-200">{last}</p>
                      </div>
                      <div className="rounded-lg bg-white/50 p-2 dark:bg-ink-900/40">
                        <p className="text-[10px] font-semibold uppercase text-ink-500">{t("automationPage.toolsCallCount")}</p>
                        <p className="mt-0.5 font-medium tabular-nums text-ink-800 dark:text-ink-200">{calls}</p>
                      </div>
                      <div className="rounded-lg bg-white/50 p-2 dark:bg-ink-900/40">
                        <p className="text-[10px] font-semibold uppercase text-ink-500">{t("automationPage.toolsAvgLatency")}</p>
                        <p className="mt-0.5 font-medium tabular-nums text-ink-800 dark:text-ink-200">{avg}</p>
                      </div>
                    </div>
                    {tool.tags && tool.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {tool.tags.map((tag) => (
                          <span key={tag} className="rounded-md bg-ink-100 px-2 py-0.5 text-[10px] text-ink-600 dark:bg-ink-800 dark:text-ink-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-200/50 pt-4 dark:border-ink-700/50">
                      <button
                        type="button"
                        onClick={() => setEditingToolId(editingToolId === tool.id ? null : tool.id)}
                        className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                      >
                        {editingToolId === tool.id ? t("automationPage.toolCloseEditor") : t("automationPage.toolEditSecrets")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditTool(tool)}
                        className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("automationPage.toolEditTool")}
                      </button>
                      {canTest ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDrawerTool(tool);
                            setDrawerTab("test");
                            setTestResult(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          <Play className="h-3.5 w-3.5" />
                          {t("automationPage.toolsTest")}
                        </button>
                      ) : null}
                      {isHttpCustom ? (
                        <button
                          type="button"
                          onClick={() => openEditTool(tool)}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          <Play className="h-3.5 w-3.5" />
                          {t("automationPage.httpCustomOpenBuilder")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTool(tool);
                          setDrawerTab("logs");
                          void loadExecutions(tool.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold dark:border-ink-600"
                      >
                        <Activity className="h-3.5 w-3.5" />
                        {t("automationPage.toolsLogs")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCustomToolRow(tool.id)}
                        className="ml-auto text-xs font-medium text-red-600 dark:text-red-400"
                      >
                        {t("automationPage.toolRemove")}
                      </button>
                    </div>
                    {editingToolId === tool.id ? (
                      <div className="mt-4 border-t border-ink-200/60 pt-4 dark:border-ink-700/60">
                        <CredentialEditor tool={tool} t={t} onSave={(patch) => void saveToolConfigPatch(tool.id, patch)} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {hubTab === "create" ? (
        <div className={clsx("grid gap-6 lg:grid-cols-3 rounded-2xl p-5 lg:p-6", glass)}>
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("automationPage.toolsCreateHeading")}</h3>
            <p className="text-xs text-ink-500">{t("automationPage.toolsCreateBlurb")}</p>
            {createErr ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {createErr}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolsCreateType")}
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                >
                  <option value="HTTP_API">HTTP API</option>
                  <option value="HTTP_API_CUSTOM">HTTP API Customizada</option>
                  <option value="WEBHOOK">Webhook</option>
                  <option value="MCP">MCP Tool</option>
                  <option value="INTEGRATION">Integration</option>
                  <option value="EMAIL_API">SMTP / E-mail API</option>
                </select>
              </label>
              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolsCreateCategory")}
                <input
                  value={createCategory}
                  onChange={(e) => setCreateCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                />
              </label>
            </div>
            <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
              {t("automationPage.toolName")}
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
              {t("automationPage.toolDesc")}
              <textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolsCreateIcon")} (Lucide)
                <input
                  value={createIcon}
                  onChange={(e) => setCreateIcon(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm font-mono dark:border-ink-600 dark:bg-ink-950"
                />
              </label>
              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolsCreateColor")}
                <input
                  value={createColor}
                  onChange={(e) => setCreateColor(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                />
              </label>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-700 dark:text-ink-300">{t("automationPage.toolsCreateConfigJson")}</span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-brand-600"
                  onClick={() => {
                    try {
                      setCreateConfigJson(JSON.stringify(JSON.parse(createConfigJson), null, 2));
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {t("automationPage.toolsJsonBeautify")}
                </button>
              </div>
              <textarea
                value={createConfigJson}
                onChange={(e) => setCreateConfigJson(e.target.value)}
                rows={12}
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-950/90 px-3 py-2 font-mono text-xs text-ink-100 dark:border-ink-600"
              />
            </div>
            <div>
              <span className="text-xs font-medium text-ink-700 dark:text-ink-300">{t("automationPage.toolParamsJson")}</span>
              <textarea
                value={createParamsJson}
                onChange={(e) => setCreateParamsJson(e.target.value)}
                rows={6}
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-950/90 px-3 py-2 font-mono text-xs text-ink-100 dark:border-ink-600"
              />
            </div>
            <button
              type="button"
              disabled={createSaving}
              onClick={() => void saveNewTool()}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {createSaving ? t("automationPage.toolsSaving") : t("automationPage.toolsCreateSubmit")}
            </button>
          </div>
          <div className="space-y-3 rounded-xl border border-ink-200/60 bg-white/40 p-4 dark:border-ink-700/60 dark:bg-ink-900/30">
            <p className="text-xs font-semibold text-ink-800 dark:text-ink-200">{t("automationPage.toolsVariablesTitle")}</p>
            <p className="text-[11px] text-ink-500">{t("automationPage.toolsVariablesHelp")}</p>
            <ul className="space-y-1.5">
              {VARIABLE_SNIPPETS.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(v)}
                    className="w-full rounded-lg bg-ink-100 px-2 py-1.5 text-left font-mono text-[11px] text-brand-700 hover:bg-ink-200 dark:bg-ink-800 dark:text-brand-300 dark:hover:bg-ink-700"
                  >
                    {v}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {drawerTool ? (
        <div className="fixed inset-0 z-[60] flex justify-end bg-black/40 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-950">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-ink-800">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-500">{drawerTool.toolType}</p>
                <p className="font-semibold text-ink-900 dark:text-ink-50">{drawerTool.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerTool(null)}
                className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1 border-b border-ink-200 px-3 py-2 dark:border-ink-800">
              <button
                type="button"
                onClick={() => setDrawerTab("test")}
                className={clsx(
                  "flex-1 rounded-lg py-2 text-xs font-semibold",
                  drawerTab === "test" ? "bg-brand-600 text-white" : "text-ink-600 dark:text-ink-400",
                )}
              >
                {t("automationPage.toolsTestPanel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerTab("logs");
                  void loadExecutions(drawerTool.id);
                }}
                className={clsx(
                  "flex-1 rounded-lg py-2 text-xs font-semibold",
                  drawerTab === "logs" ? "bg-brand-600 text-white" : "text-ink-600 dark:text-ink-400",
                )}
              >
                {t("automationPage.toolsLogsPanel")}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm">
              {drawerTab === "test" ? (
                drawerTool.toolType === "HTTP_API" || drawerTool.toolType === "WEBHOOK" ? (
                  <div className="space-y-3">
                    <p className="text-xs text-ink-500">{t("automationPage.toolsTestHelp")}</p>
                    <label className="block text-xs font-medium">
                      {t("automationPage.toolsTestPayload")}
                      <textarea
                        value={testBodyJson}
                        onChange={(e) => setTestBodyJson(e.target.value)}
                        rows={6}
                        className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
                        spellCheck={false}
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      {t("automationPage.toolsTestContext")}
                      <textarea
                        value={testContextJson}
                        onChange={(e) => setTestContextJson(e.target.value)}
                        rows={8}
                        className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
                        spellCheck={false}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={testRunning}
                      onClick={() => void runTest()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-50"
                    >
                      {testRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {t("automationPage.toolsRunTest")}
                    </button>
                    {testResult ? (
                      <pre className="max-h-64 overflow-auto rounded-lg bg-ink-100 p-3 text-xs dark:bg-ink-900">
                        {JSON.stringify(testResult, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-ink-500">{t("automationPage.toolsTestUnsupported")}</p>
                )
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => exportLogs()}
                      className="text-xs font-semibold text-brand-600"
                    >
                      {t("automationPage.toolsExportLogs")}
                    </button>
                  </div>
                  {execLoading ? (
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-ink-400" />
                  ) : executions.length === 0 ? (
                    <p className="text-xs text-ink-500">{t("automationPage.toolsLogsEmpty")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {executions.map((ex) => (
                        <li key={String(ex.id)} className="rounded-lg border border-ink-200 p-2 text-xs dark:border-ink-700">
                          <div className="flex justify-between gap-2">
                            <span className="font-mono text-[10px] text-ink-500">{String(ex.createdAt)}</span>
                            <span
                              className={clsx(
                                "font-semibold",
                                ex.ok ? "text-emerald-600" : "text-red-600",
                              )}
                            >
                              {ex.statusCode != null ? String(ex.statusCode) : "—"} · {String(ex.durationMs)}ms
                            </span>
                          </div>
                          {ex.errorMessage ? (
                            <p className="mt-1 text-red-600 dark:text-red-400">{String(ex.errorMessage)}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editTool ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-950">
            <div className="flex items-center justify-between border-b border-ink-200 px-5 py-4 dark:border-ink-800">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-500">{editTool.toolType}</p>
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.toolEditTool")}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditTool(null)}
                className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                ×
              </button>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
              {editErr ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {editErr}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolName")}
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
                <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolsCreateCategory")}
                  <input
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
              </div>

              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolDesc")}
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolsCreateIcon")} (Lucide)
                  <input
                    value={editIcon}
                    onChange={(e) => setEditIcon(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
                <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                  {t("automationPage.toolsCreateColor")}
                  <input
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  />
                </label>
              </div>

              <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
                {t("automationPage.toolTagsLabel")}
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                />
              </label>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink-800 dark:text-ink-200">{t("automationPage.toolParamsJson")}</p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setEditParamsJson(JSON.stringify(JSON.parse(editParamsJson || "{}"), null, 2));
                    } catch {
                      setEditErr(t("automationPage.toolsCreateParamsInvalid"));
                    }
                  }}
                  className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t("automationPage.toolsJsonBeautify")}
                </button>
              </div>
              <textarea
                value={editParamsJson}
                onChange={(e) => setEditParamsJson(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
                spellCheck={false}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-5 py-4 dark:border-ink-800">
              <button
                type="button"
                onClick={() => setEditTool(null)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-xs font-semibold dark:border-ink-700 dark:text-ink-200"
              >
                {t("automationPage.cancel")}
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void saveToolEdits()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("automationPage.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
