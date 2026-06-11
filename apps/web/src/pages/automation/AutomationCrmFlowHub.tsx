import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Copy,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { CrmFlowBuilder } from "./CrmFlowBuilder";
import { defaultCrmFlow, type CrmFlowDefinition, type CrmFlowRow } from "./crmFlowTypes";

type DashboardData = {
  cards: {
    activeFlows: number;
    inactiveFlows: number;
    executionsToday: number;
    executionsMonth: number;
    failures: number;
    successRate: number;
    avgDurationMs: number;
  };
  executionsByDay: { day: string; count: number }[];
  topFlows: { id: string; name: string; executionCount: number; flowType: string }[];
};

type TagOption = { id: string; name: string };
type UserOption = { id: string; name: string };
type TemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  flowType: string;
};

type ExecutionRow = {
  id: string;
  status: string;
  triggerType: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  logEntries?: { sequence: number; message: string; level: string; nodeType: string | null }[];
};

export function AutomationCrmFlowHub() {
  const { t } = useI18n();
  const [view, setView] = useState<"dashboard" | "list" | "editor">("dashboard");
  const [flows, setFlows] = useState<CrmFlowRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftFlowType, setDraftFlowType] = useState<CrmFlowRow["flowType"]>("CRM");
  const [draftStatus, setDraftStatus] = useState<CrmFlowRow["status"]>("DRAFT");
  const [draftPublished, setDraftPublished] = useState(false);
  const [draftFlow, setDraftFlow] = useState<CrmFlowDefinition>(defaultCrmFlow());
  const [draftTrigger, setDraftTrigger] = useState<Record<string, unknown>>({ type: "lead_created" });
  const [tags, setTags] = useState<TagOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const selected = flows.find((f) => f.id === selectedId) ?? null;

  const loadExecutions = useCallback(async () => {
    if (!selectedId) return;
    setExecutionsLoading(true);
    try {
      const res = await api.get<{ data: ExecutionRow[] }>(
        `/automation/crm-flows/${selectedId}/executions`,
      );
      setExecutions(res.data ?? []);
    } catch {
      setExecutions([]);
    } finally {
      setExecutionsLoading(false);
    }
  }, [selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterName.trim()) params.set("name", filterName.trim());
      if (filterType) params.set("flowType", filterType);
      if (filterStatus) params.set("status", filterStatus);
      const qs = params.toString();
      const [flowsRes, dashRes, tagList, userList, tplRes] = await Promise.all([
        api.get<{ data: CrmFlowRow[] }>(`/automation/crm-flows${qs ? `?${qs}` : ""}`),
        api.get<DashboardData>("/automation/crm-flows/dashboard"),
        api.get<TagOption[]>("/tags").catch(() => []),
        api.get<UserOption[]>("/users").catch(() => []),
        api.get<{ data: TemplateRow[] }>("/automation/crm-flows/templates").catch(() => ({ data: [] })),
      ]);
      setTemplates(tplRes.data ?? []);
      setFlows(flowsRes.data ?? []);
      setDashboard(dashRes);
      setTags(Array.isArray(tagList) ? tagList : []);
      setUsers(Array.isArray(userList) ? userList : []);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, [filterName, filterType, filterStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId && view === "editor") void loadExecutions();
  }, [selectedId, view, loadExecutions]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ crmFlowId?: string }>).detail;
      if (detail?.crmFlowId === selectedId) void loadExecutions();
    };
    window.addEventListener("openconduit:crm-flow-execution-updated", handler);
    return () => window.removeEventListener("openconduit:crm-flow-execution-updated", handler);
  }, [selectedId, loadExecutions]);

  const openEditor = (row: CrmFlowRow | null) => {
    if (row) {
      setSelectedId(row.id);
      setDraftName(row.name);
      setDraftDesc(row.description ?? "");
      setDraftFlowType(row.flowType);
      setDraftStatus(row.status);
      setDraftPublished(row.isPublished);
      setDraftFlow(row.flowDefinition ?? defaultCrmFlow());
      setDraftTrigger((row.triggerConfig as Record<string, unknown>) ?? { type: "lead_created" });
    } else {
      setSelectedId(null);
      setDraftName(t("crmFlows.newFlowName"));
      setDraftDesc("");
      setDraftFlowType("CRM");
      setDraftStatus("DRAFT");
      setDraftPublished(false);
      setDraftFlow(defaultCrmFlow());
      setDraftTrigger({ type: "lead_created" });
    }
    setView("editor");
  };

  const saveFlow = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draftName.trim(),
        description: draftDesc.trim() || null,
        flowType: draftFlowType,
        status: draftStatus,
        isPublished: draftPublished,
        flowDefinition: draftFlow,
        triggerConfig: draftTrigger,
      };
      if (selectedId) {
        const res = await api.patch<{ data: CrmFlowRow }>(`/automation/crm-flows/${selectedId}`, payload);
        setFlows((prev) => prev.map((f) => (f.id === selectedId ? res.data : f)));
      } else {
        const res = await api.post<{ data: CrmFlowRow }>("/automation/crm-flows", payload);
        setSelectedId(res.data.id);
        setFlows((prev) => [res.data, ...prev]);
      }
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteFlow = async (id: string) => {
    if (!window.confirm(t("crmFlows.deleteConfirm"))) return;
    await api.delete(`/automation/crm-flows/${id}`);
    if (selectedId === id) {
      setSelectedId(null);
      setView("list");
    }
    await load();
  };

  const duplicateFlow = async (id: string) => {
    const res = await api.post<{ data: CrmFlowRow }>(`/automation/crm-flows/${id}/duplicate`);
    setFlows((prev) => [res.data, ...prev]);
    openEditor(res.data);
  };

  const exportFlow = async (id: string) => {
    const bundle = await api.get<Record<string, unknown>>(`/automation/crm-flows/${id}/export`);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crm-flow-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reprocessExecution = async (executionId: string) => {
    if (!selectedId) return;
    await api.post(`/automation/crm-flows/${selectedId}/executions/${executionId}/reprocess`);
    await loadExecutions();
  };

  const testFlow = async () => {
    if (!selectedId) return;
    await api.post(`/automation/crm-flows/${selectedId}/test`, { nome: "Teste", telefone: "+5511999999999" });
    await load();
  };

  const createFromTemplate = async (templateKey: string) => {
    const res = await api.post<{ data: CrmFlowRow }>("/automation/crm-flows", {
      name: templates.find((t) => t.key === templateKey)?.name ?? t("crmFlows.newFlowName"),
      templateKey,
    });
    setFlows((prev) => [res.data, ...prev]);
    openEditor(res.data);
    setTemplatesOpen(false);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text) as { flow?: unknown };
    await api.post("/automation/crm-flows/import", json);
    await load();
    setView("list");
  };

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 pb-3 dark:border-ink-700">
        {(["dashboard", "list", "editor"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              view === v
                ? "bg-brand-600 text-white"
                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
          >
            {t(`crmFlows.view.${v}`)}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            {t("crmFlows.newFlow")}
          </button>
          <button
            type="button"
            onClick={() => setTemplatesOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600"
          >
            {t("crmFlows.templates")}
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600"
          >
            <Upload className="h-4 w-4" />
            {t("crmFlows.import")}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-rose-600">{t("crmFlows.error")}</p> : null}

      {templatesOpen ? (
        <div className="grid gap-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900 sm:grid-cols-2 lg:grid-cols-4">
          {templates.length === 0 ? (
            <p className="text-sm text-ink-500">{t("crmFlows.noTemplates")}</p>
          ) : (
            templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => void createFromTemplate(tpl.key)}
                className="rounded-lg border border-ink-200 p-3 text-left hover:border-brand-400 dark:border-ink-600"
              >
                <p className="text-xs font-medium uppercase text-brand-600">{tpl.category}</p>
                <p className="mt-1 text-sm font-semibold">{tpl.name}</p>
                <p className="mt-1 text-xs text-ink-500">{tpl.description}</p>
              </button>
            ))
          )}
        </div>
      ) : null}

      {view === "dashboard" && dashboard ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              ["activeFlows", dashboard.cards.activeFlows],
              ["inactiveFlows", dashboard.cards.inactiveFlows],
              ["executionsToday", dashboard.cards.executionsToday],
              ["executionsMonth", dashboard.cards.executionsMonth],
              ["failures", dashboard.cards.failures],
              ["successRate", `${dashboard.cards.successRate}%`],
            ].map(([key, val]) => (
              <div
                key={key}
                className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900"
              >
                <p className="text-xs text-ink-500">{t(`crmFlows.kpi.${key}`)}</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900 dark:text-ink-100">{val}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-700">
              <h3 className="mb-3 text-sm font-semibold">{t("crmFlows.chartExecutionsByDay")}</h3>
              <ul className="space-y-1 text-xs">
                {dashboard.executionsByDay.length === 0 ? (
                  <li className="text-ink-500">{t("crmFlows.noData")}</li>
                ) : (
                  dashboard.executionsByDay.map((row) => (
                    <li key={row.day} className="flex justify-between">
                      <span>{row.day}</span>
                      <span className="font-medium">{row.count}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-700">
              <h3 className="mb-3 text-sm font-semibold">{t("crmFlows.chartTopFlows")}</h3>
              <ul className="space-y-2 text-sm">
                {dashboard.topFlows.map((f) => (
                  <li key={f.id} className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-ink-500">{f.executionCount}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-500">
                {t("crmFlows.avgDuration")}: {dashboard.cards.avgDurationMs} ms
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {view === "list" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder={t("crmFlows.filterName")}
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
            >
              <option value="">{t("crmFlows.filterAllTypes")}</option>
              {["CRM", "WHATSAPP", "TELEPHONY", "AGENDA", "SYSTEM"].map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900"
            >
              <option value="">{t("crmFlows.filterAllStatus")}</option>
              {["ACTIVE", "INACTIVE", "DRAFT"].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border px-3 py-1.5 text-sm dark:border-ink-600"
            >
              {t("crmFlows.applyFilters")}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-700">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase text-ink-500 dark:bg-ink-900">
                <tr>
                  <th className="px-4 py-2">{t("crmFlows.colName")}</th>
                  <th className="px-4 py-2">{t("crmFlows.colType")}</th>
                  <th className="px-4 py-2">{t("crmFlows.colStatus")}</th>
                  <th className="px-4 py-2">{t("crmFlows.colLastRun")}</th>
                  <th className="px-4 py-2">{t("crmFlows.colExecutions")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {flows.map((row) => (
                  <tr key={row.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    <td className="px-4 py-2">{row.flowType}</td>
                    <td className="px-4 py-2">{row.status}</td>
                    <td className="px-4 py-2 text-ink-500">
                      {row.lastExecutedAt ? new Date(row.lastExecutedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">{row.executionCount}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => openEditor(row)} className="rounded p-1 hover:bg-ink-100 dark:hover:bg-ink-800" title={t("crmFlows.edit")}>
                          <Workflow className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void duplicateFlow(row.id)} className="rounded p-1 hover:bg-ink-100 dark:hover:bg-ink-800" title={t("crmFlows.duplicate")}>
                          <Copy className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void exportFlow(row.id)} className="rounded p-1 hover:bg-ink-100 dark:hover:bg-ink-800" title={t("crmFlows.export")}>
                          <Download className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void deleteFlow(row.id)} className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-ink-800" title={t("crmFlows.delete")}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {view === "editor" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              {t("crmFlows.fieldName")}
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              />
            </label>
            <label className="text-xs">
              {t("crmFlows.colType")}
              <select
                value={draftFlowType}
                onChange={(e) => setDraftFlowType(e.target.value as CrmFlowRow["flowType"])}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              >
                {["CRM", "WHATSAPP", "TELEPHONY", "AGENDA", "SYSTEM"].map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("crmFlows.colStatus")}
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as CrmFlowRow["status"])}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              >
                {["DRAFT", "ACTIVE", "INACTIVE"].map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 text-xs">
              <input
                type="checkbox"
                checked={draftPublished}
                onChange={(e) => setDraftPublished(e.target.checked)}
                className="rounded"
              />
              {t("crmFlows.published")}
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs">
              {t("crmFlows.fieldTriggerType")}
              <input
                value={String(draftTrigger.type ?? "lead_created")}
                onChange={(e) => setDraftTrigger((p) => ({ ...p, type: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              />
            </label>
            <label className="text-xs">
              {t("crmFlows.fieldTriggerInbox")}
              <input
                value={String(draftTrigger.inboxId ?? "")}
                onChange={(e) =>
                  setDraftTrigger((p) => ({ ...p, inboxId: e.target.value.trim() || undefined }))
                }
                placeholder={t("crmFlows.optional")}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
              />
            </label>
            {draftTrigger.type === "contact_no_reply" ? (
              <label className="text-xs">
                {t("crmFlows.fieldNoReplyHours")}
                <input
                  type="number"
                  min={1}
                  value={Number(draftTrigger.noReplyHours ?? 24)}
                  onChange={(e) =>
                    setDraftTrigger((p) => ({ ...p, noReplyHours: Number(e.target.value) }))
                  }
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
                />
              </label>
            ) : null}
          </div>
          <label className="block text-xs">
            {t("crmFlows.fieldDescription")}
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900"
            />
          </label>
          <CrmFlowBuilder value={draftFlow} onChange={setDraftFlow} tags={tags} users={users} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !draftName.trim()}
              onClick={() => void saveFlow()}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("common.save")}
            </button>
            {selectedId ? (
              <button
                type="button"
                onClick={() => void testFlow()}
                className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm dark:border-ink-600"
              >
                <Play className="h-4 w-4" />
                {t("crmFlows.test")}
              </button>
            ) : null}
          </div>
          {selectedId ? (
            <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-700">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t("crmFlows.executionsTitle")}</h3>
                <button
                  type="button"
                  onClick={() => void loadExecutions()}
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs dark:border-ink-600"
                >
                  <RefreshCw className={clsx("h-3 w-3", executionsLoading && "animate-spin")} />
                  {t("crmFlows.refreshExecutions")}
                </button>
              </div>
              {executionsLoading && executions.length === 0 ? (
                <p className="text-xs text-ink-500">{t("common.loading")}</p>
              ) : executions.length === 0 ? (
                <p className="text-xs text-ink-500">{t("crmFlows.noExecutions")}</p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
                  {executions.map((ex) => (
                    <li
                      key={ex.id}
                      className="rounded-lg border border-ink-100 p-2 dark:border-ink-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{ex.status}</span>
                        <span className="text-ink-500">
                          {new Date(ex.startedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-ink-500">{ex.triggerType}</p>
                      {ex.errorMessage ? (
                        <p className="text-rose-600">{ex.errorMessage}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void reprocessExecution(ex.id)}
                        className="mt-1 text-brand-600 hover:underline"
                      >
                        {t("crmFlows.reprocess")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
