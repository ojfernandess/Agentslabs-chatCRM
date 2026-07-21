import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronRight, ClipboardCopy, Download, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { resolveAutomationToolIdFromLogNode } from "@/pages/automation/agentPromptBuilder";
import { ExecutionFlowView } from "@/pages/automation/ExecutionFlowView";
import type { ExecutionFlowGraph, ExecutionQualitySignal } from "@/pages/automation/executionQualityTypes";

type BotRow = { id: string; name: string };
type ToolRow = { id: string; name: string };

type ExecRow = {
  id: string;
  botId: string;
  conversationId: string | null;
  workflowKey: string;
  workflowName: string;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  bot: { name: string };
};

type LogEntry = {
  id: string;
  sequence: number;
  level: string;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  message: string;
  inputContext: unknown;
  outputContext: unknown;
  stackTrace: string | null;
  createdAt: string;
  automationToolId?: string | null;
  automationToolName?: string | null;
};

type ExecDetail = ExecRow & {
  logEntries: LogEntry[];
  qualitySignals?: ExecutionQualitySignal[];
  flowGraph?: ExecutionFlowGraph;
};

function levelBadgeClass(level: string): string {
  switch (level) {
    case "DEBUG":
      return "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200";
    case "INFO":
      return "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100";
    case "WARN":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
    case "ERROR":
    case "FATAL":
      return "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100";
    default:
      return "bg-ink-50 text-ink-600";
  }
}

function treeDepth(nodePath: string): number {
  if (!nodePath) return 0;
  return nodePath.split("/").filter(Boolean).length - 1;
}

function resolveCustomToolLabel(
  entry: Pick<LogEntry, "nodeId" | "nodeName" | "automationToolId" | "automationToolName">,
  toolNameById: Map<string, string>,
): { title: string; toolFunctionId: string | null } {
  const toolUuid =
    entry.automationToolId ?? resolveAutomationToolIdFromLogNode(entry.nodeId, entry.nodeName);
  const toolFunctionId =
    entry.nodeId.startsWith("oc_tool_") ? entry.nodeId : toolUuid ? `oc_tool_${toolUuid.replace(/-/g, "")}` : null;

  let toolName = entry.automationToolName ?? (toolUuid ? toolNameById.get(toolUuid) : undefined) ?? null;
  if (!toolName && entry.nodeName.startsWith("Tool: ") && !/oc_tool_/i.test(entry.nodeName)) {
    toolName = entry.nodeName.slice("Tool: ".length).trim() || null;
  }

  if (toolName) {
    return { title: `Tool: ${toolName}`, toolFunctionId: toolFunctionId ?? entry.nodeId };
  }
  if (toolFunctionId || toolUuid) {
    return { title: entry.nodeName, toolFunctionId: toolFunctionId ?? entry.nodeId };
  }
  return { title: entry.nodeName, toolFunctionId: null };
}

function csvEscapeCell(s: string): string {
  const t = s.replace(/"/g, '""');
  if (/[",\n\r]/.test(t)) return `"${t}"`;
  return t;
}

/** Same columns as GET …/export?format=csv (API). */
function buildExecutionCsv(detail: ExecDetail, entries: LogEntry[]): string {
  const header = ["sequence", "level", "nodePath", "nodeId", "nodeName", "message", "createdAt"].join(",");
  const lines = entries.map((e) =>
    [
      e.sequence,
      e.level,
      csvEscapeCell(e.nodePath),
      csvEscapeCell(e.nodeId),
      csvEscapeCell(e.nodeName),
      csvEscapeCell(e.message),
      new Date(e.createdAt).toISOString(),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

function buildExecutionMarkdown(detail: ExecDetail, entries: LogEntry[]): string {
  const lines: string[] = [
    "# Automation execution",
    "",
    `- **id:** \`${detail.id}\``,
    `- **bot:** ${detail.bot.name}`,
    `- **workflowKey:** \`${detail.workflowKey}\``,
    `- **workflowName:** ${detail.workflowName}`,
    `- **status:** ${detail.status}`,
    `- **startedAt:** ${new Date(detail.startedAt).toISOString()}`,
    `- **finishedAt:** ${detail.finishedAt ? new Date(detail.finishedAt).toISOString() : "—"}`,
    `- **conversationId:** ${detail.conversationId ?? "—"}`,
    "",
  ];
  if (detail.errorMessage) {
    lines.push("## errorMessage", "", "```", detail.errorMessage, "```", "");
  }
  lines.push("## Log entries", "");
  for (const e of entries) {
    lines.push(`### #${e.sequence} — ${e.level} — ${e.nodeName}`, "");
    lines.push(`- **nodePath:** \`${e.nodePath}\``);
    lines.push(`- **nodeId:** \`${e.nodeId}\``);
    lines.push(`- **createdAt:** ${new Date(e.createdAt).toISOString()}`);
    lines.push("");
    lines.push(e.message);
    lines.push("");
    if (e.inputContext != null) {
      lines.push("**inputContext**", "", "```json", JSON.stringify(e.inputContext, null, 2), "```", "");
    }
    if (e.outputContext != null) {
      lines.push("**outputContext**", "", "```json", JSON.stringify(e.outputContext, null, 2), "```", "");
    }
    if (e.stackTrace) {
      lines.push("**stackTrace**", "", "```", e.stackTrace, "```", "");
    }
    lines.push("---", "");
  }
  return lines.join("\n").trimEnd();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function AutomationExecutionsTab({
  t,
  loading,
  setLoading,
  setError,
  bots,
  tools,
}: {
  t: (path: string) => string;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (code: string) => void;
  bots: BotRow[];
  tools: ToolRow[];
}) {
  const [rows, setRows] = useState<ExecRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workflowKey, setWorkflowKey] = useState("");
  const [level, setLevel] = useState("");
  const [botId, setBotId] = useState("");
  const [executionId, setExecutionId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<{
    retentionDays: number;
    minPersistLevel: string;
    alertWebhookUrl: string | null;
    alertEmail: string | null;
    alertMinLevel: string;
  } | null>(null);
  const [queryNonce, setQueryNonce] = useState(0);
  const [copyFlash, setCopyFlash] = useState<"ok" | "fail" | null>(null);
  const copyFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localTools, setLocalTools] = useState<ToolRow[]>([]);
  const [detailSubTab, setDetailSubTab] = useState<"logs" | "flow" | "quality">("logs");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ data: ToolRow[] }>("/automation/custom-tools");
        if (!cancelled) {
          setLocalTools((res.data ?? []).map((tool) => ({ id: tool.id, name: tool.name })));
        }
      } catch {
        if (!cancelled) setLocalTools([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "40");
        qs.set("offset", String(offset));
        if (from) qs.set("from", new Date(from).toISOString());
        if (to) qs.set("to", new Date(to).toISOString());
        if (workflowKey.trim()) qs.set("workflowKey", workflowKey.trim());
        if (level) qs.set("level", level);
        if (botId) qs.set("botId", botId);
        if (executionId.trim()) qs.set("executionId", executionId.trim());
        const res = await api.get<{ data: ExecRow[]; hasMore: boolean; nextOffset: number }>(
          `/automation/execution-logs?${qs.toString()}`,
        );
        if (!cancelled) {
          setRows(res.data);
          setHasMore(res.hasMore);
        }
      } catch {
        if (!cancelled) setError("load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLoading, setError, offset, from, to, workflowKey, level, botId, executionId, queryNonce]);

  const loadDetail = useCallback(
    async (id: string) => {
      setLoading(true);
      setError("");
      try {
        const d = await api.get<ExecDetail>(`/automation/execution-logs/${id}`);
        setDetail(d);
      } catch {
        setError("load_failed");
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError],
  );

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get<{
        retentionDays: number;
        minPersistLevel: string;
        alertWebhookUrl: string | null;
        alertEmail: string | null;
        alertMinLevel: string;
      }>("/automation/execution-logs/settings");
      setSettings({
        retentionDays: s.retentionDays,
        minPersistLevel: s.minPersistLevel,
        alertWebhookUrl: s.alertWebhookUrl,
        alertEmail: s.alertEmail,
        alertMinLevel: s.alertMinLevel,
      });
    } catch {
      setError("load_failed");
    }
  }, [setError]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
    setDetailSubTab("logs");
    setDismissedSignals(new Set());
  }, [selectedId, loadDetail]);

  const sortedEntries = useMemo(() => {
    if (!detail?.logEntries) return [];
    return [...detail.logEntries].sort((a, b) => a.sequence - b.sequence);
  }, [detail]);

  const toolNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tool of [...tools, ...localTools]) {
      if (tool.id && tool.name) map.set(tool.id, tool.name);
    }
    return map;
  }, [tools, localTools]);

  const visibleQualitySignals = useMemo(() => {
    if (!detail?.qualitySignals) return [];
    return detail.qualitySignals.filter((s) => !dismissedSignals.has(s.id));
  }, [detail, dismissedSignals]);

  const runQualityAction = useCallback(
    async (action: "send_now" | "ignore" | "retry", signalId?: string) => {
      if (!selectedId) return;
      setActionBusy(action);
      setError("");
      try {
        await api.post(`/automation/execution-logs/${selectedId}/quality-action`, { action });
        if (signalId) setDismissedSignals((prev) => new Set(prev).add(signalId));
        if (action !== "ignore") await loadDetail(selectedId);
      } catch {
        setError("load_failed");
      } finally {
        setActionBusy(null);
      }
    },
    [selectedId, loadDetail, setError],
  );

  const signalIcon = (kind: ExecutionQualitySignal["kind"]) => {
    switch (kind) {
      case "possible_hallucination":
        return "🔴";
      case "lost_context":
      case "tool_not_answered":
      case "tool_ignored":
      case "conversation_loop":
        return "⚠";
      default:
        return "ℹ";
    }
  };

  const exportFile = async (format: "json" | "csv") => {
    if (!selectedId) return;
    try {
      const blob = await api.fetchBlob(`/automation/execution-logs/${selectedId}/export?format=${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `execution-${selectedId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("load_failed");
    }
  };

  const flashCopyMessage = useCallback((kind: "ok" | "fail") => {
    if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
    setCopyFlash(kind);
    copyFlashTimer.current = setTimeout(() => {
      setCopyFlash(null);
      copyFlashTimer.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
    };
  }, []);

  const copyExecutionAs = useCallback(
    async (format: "markdown" | "json" | "csv") => {
      if (!detail) return;
      const entries = [...detail.logEntries].sort((a, b) => a.sequence - b.sequence);
      let text: string;
      if (format === "json") text = JSON.stringify(detail, null, 2);
      else if (format === "csv") text = buildExecutionCsv(detail, entries);
      else text = buildExecutionMarkdown(detail, entries);
      const ok = await copyTextToClipboard(text);
      if (ok) flashCopyMessage("ok");
      else flashCopyMessage("fail");
    },
    [detail, flashCopyMessage, t],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {t("automationPage.execLogsFrom")}
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
          />
        </label>
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {t("automationPage.execLogsTo")}
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
          />
        </label>
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {t("automationPage.execLogsWorkflow")}
          <input
            value={workflowKey}
            onChange={(e) => setWorkflowKey(e.target.value)}
            placeholder="native_agent"
            className="mt-1 block min-w-[140px] rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
          />
        </label>
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {t("automationPage.execLogsLevel")}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="mt-1 block rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
          >
            <option value="">{t("automationPage.execLogsAnyLevel")}</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="FATAL">FATAL</option>
          </select>
        </label>
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          {t("automationPage.execLogsBot")}
          <select
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
            className="mt-1 block min-w-[160px] rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
          >
            <option value="">{t("automationPage.execLogsAnyBot")}</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-700 dark:text-ink-200">
          executionId
          <input
            value={executionId}
            onChange={(e) => setExecutionId(e.target.value)}
            className="mt-1 block min-w-[220px] rounded-lg border border-ink-200 px-2 py-1 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setOffset(0);
            setQueryNonce((n) => n + 1);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("automationPage.execLogsApply")}
        </button>
        <button
          type="button"
          onClick={() => {
            setSettingsOpen((v) => !v);
            if (!settings) void loadSettings();
          }}
          className="rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600"
        >
          {t("automationPage.execLogsSettings")}
        </button>
      </div>

      {settingsOpen && settings ? (
        <div className="rounded-xl border border-ink-200 bg-ink-50/80 p-4 dark:border-ink-700 dark:bg-ink-900/40">
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.execLogsSettingsTitle")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              {t("automationPage.execLogsRetention")}
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retentionDays}
                onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs">
              {t("automationPage.execLogsMinPersist")}
              <select
                value={settings.minPersistLevel}
                onChange={(e) => setSettings({ ...settings, minPersistLevel: e.target.value })}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
              >
                {["DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs sm:col-span-2">
              {t("automationPage.execLogsAlertWebhook")}
              <input
                value={settings.alertWebhookUrl ?? ""}
                onChange={(e) => setSettings({ ...settings, alertWebhookUrl: e.target.value || null })}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs">
              {t("automationPage.execLogsAlertEmail")}
              <input
                value={settings.alertEmail ?? ""}
                onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value || null })}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
              />
            </label>
            <label className="text-xs">
              {t("automationPage.execLogsAlertMin")}
              <select
                value={settings.alertMinLevel}
                onChange={(e) => setSettings({ ...settings, alertMinLevel: e.target.value })}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm dark:border-ink-600 dark:bg-ink-950"
              >
                {["DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-ink-100 dark:text-ink-900"
            onClick={async () => {
              setLoading(true);
              try {
                await api.patch("/automation/execution-logs/settings", settings);
                await loadSettings();
              } catch {
                setError("load_failed");
              } finally {
                setLoading(false);
              }
            }}
          >
            {t("automationPage.execLogsSaveSettings")}
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900/50">
          <div className="border-b border-ink-100 px-3 py-2 text-sm font-semibold dark:border-ink-800">
            {t("automationPage.execLogsList")}
          </div>
          <ul className="max-h-[480px] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={clsx(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800/60",
                    selectedId === r.id && "bg-brand-50/80 dark:bg-brand-950/30",
                  )}
                >
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900 dark:text-ink-50">{r.bot.name}</p>
                    <p className="truncate text-xs text-ink-500">{r.workflowKey}</p>
                    <p className="text-[10px] text-ink-400">{new Date(r.startedAt).toISOString()}</p>
                    <span
                      className={clsx(
                        "mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        r.status === "success"
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                          : r.status === "error"
                            ? "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100"
                            : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
                      )}
                    >
                      {r.status}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="border-t border-ink-100 p-2 dark:border-ink-800">
              <button
                type="button"
                className="text-xs font-semibold text-brand-600 underline"
                onClick={() => setOffset((o) => o + 40)}
              >
                {t("automationPage.execLogsMore")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900/50">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2 dark:border-ink-800">
            <p className="text-sm font-semibold">{t("automationPage.execLogsDetail")}</p>
            {selectedId ? (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {detail ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void copyExecutionAs("markdown")}
                      className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-ink-600"
                      title={t("automationPage.execLogsCopyMarkdown")}
                    >
                      <ClipboardCopy className="h-3 w-3" /> MD
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyExecutionAs("json")}
                      className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-ink-600"
                      title={t("automationPage.execLogsCopyJson")}
                    >
                      <ClipboardCopy className="h-3 w-3" /> JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyExecutionAs("csv")}
                      className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-ink-600"
                      title={t("automationPage.execLogsCopyCsv")}
                    >
                      <ClipboardCopy className="h-3 w-3" /> CSV
                    </button>
                  </>
                ) : null}
                <span className="mx-0.5 hidden text-ink-300 sm:inline" aria-hidden>
                  |
                </span>
                <button
                  type="button"
                  onClick={() => void exportFile("json")}
                  className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-ink-600"
                >
                  <Download className="h-3 w-3" /> JSON
                </button>
                <button
                  type="button"
                  onClick={() => void exportFile("csv")}
                  className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-ink-600"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
                {copyFlash ? (
                  <span
                    className={clsx(
                      "ml-1 max-w-[200px] truncate text-[10px]",
                      copyFlash === "ok"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {copyFlash === "ok" ? t("automationPage.execLogsCopied") : t("automationPage.execLogsCopyFailed")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {!selectedId ? (
            <p className="p-4 text-sm text-ink-500">{t("automationPage.execLogsPick")}</p>
          ) : !detail ? (
            <p className="p-4 text-sm text-ink-500">{loading ? "…" : "—"}</p>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <p className="px-2 pt-2 font-mono text-[10px] text-ink-400">{detail.id}</p>

              {visibleQualitySignals.length > 0 ? (
                <div className="mx-2 mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/90 p-2 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                    {t("automationPage.execQualityTitle")}
                  </p>
                  {visibleQualitySignals.map((signal) => (
                    <div
                      key={signal.id}
                      className={clsx(
                        "rounded-lg border px-2 py-2 text-xs",
                        signal.severity === "error"
                          ? "border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/30"
                          : "border-amber-200 bg-white/80 dark:border-amber-900/30 dark:bg-ink-950/40",
                      )}
                    >
                      <p className="font-semibold text-ink-900 dark:text-ink-50">
                        {signalIcon(signal.kind)} {signal.title}
                      </p>
                      <p className="mt-1 text-ink-600 dark:text-ink-300">{signal.detail}</p>
                      {signal.toolName ? (
                        <p className="mt-1 text-[10px] text-ink-500">
                          {t("automationPage.execQualityTool")}: {signal.toolName}
                        </p>
                      ) : null}
                      {signal.suggestedActions?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {signal.suggestedActions.includes("send_now") ? (
                            <button
                              type="button"
                              disabled={actionBusy != null}
                              onClick={() => void runQualityAction("send_now", signal.id)}
                              className="rounded bg-brand-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                            >
                              {t("automationPage.execQualityActionSend")}
                            </button>
                          ) : null}
                          {signal.suggestedActions.includes("ignore") ? (
                            <button
                              type="button"
                              disabled={actionBusy != null}
                              onClick={() => void runQualityAction("ignore", signal.id)}
                              className="rounded border border-ink-200 px-2 py-1 text-[10px] font-semibold dark:border-ink-600"
                            >
                              {t("automationPage.execQualityActionIgnore")}
                            </button>
                          ) : null}
                          {signal.suggestedActions.includes("retry") ? (
                            <button
                              type="button"
                              disabled={actionBusy != null}
                              onClick={() => void runQualityAction("retry", signal.id)}
                              className="rounded border border-ink-200 px-2 py-1 text-[10px] font-semibold dark:border-ink-600"
                            >
                              {t("automationPage.execQualityActionRetry")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mx-2 mt-2 inline-flex rounded-lg border border-ink-200 p-0.5 dark:border-ink-600">
                {(["logs", "flow", "quality"] as const).map((tabId) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setDetailSubTab(tabId)}
                    className={clsx(
                      "rounded-md px-2.5 py-1 text-[11px] font-semibold",
                      detailSubTab === tabId
                        ? "bg-brand-600 text-white"
                        : "text-ink-600 hover:text-ink-900 dark:text-ink-400",
                    )}
                  >
                    {t(`automationPage.execDetailTab_${tabId}`)}
                    {tabId === "quality" && visibleQualitySignals.length > 0 ? (
                      <span className="ml-1 rounded-full bg-amber-200 px-1.5 text-[9px] text-amber-900">
                        {visibleQualitySignals.length}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {detailSubTab === "flow" ? (
                <ExecutionFlowView graph={detail.flowGraph} t={t} />
              ) : detailSubTab === "quality" ? (
                <div className="space-y-2 p-2">
                  {visibleQualitySignals.length === 0 ? (
                    <p className="text-sm text-ink-500">{t("automationPage.execQualityEmpty")}</p>
                  ) : (
                    visibleQualitySignals.map((signal) => (
                      <div
                        key={`full-${signal.id}`}
                        className="rounded-lg border border-ink-200 bg-ink-50/50 p-3 text-xs dark:border-ink-700 dark:bg-ink-950/40"
                      >
                        <p className="font-semibold">
                          {signalIcon(signal.kind)} {signal.title}
                        </p>
                        <p className="mt-1 text-ink-600 dark:text-ink-300">{signal.detail}</p>
                        {signal.toolPreview ? (
                          <pre className="mt-2 max-h-24 overflow-auto rounded bg-ink-900/90 p-2 font-mono text-[10px] text-ink-100">
                            {signal.toolPreview}
                          </pre>
                        ) : null}
                        {signal.replyPreview ? (
                          <pre className="mt-2 max-h-24 overflow-auto rounded bg-ink-800/90 p-2 font-mono text-[10px] text-ink-100">
                            {signal.replyPreview}
                          </pre>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-1 p-2">
              {sortedEntries.map((e) => {
                const toolLabel = resolveCustomToolLabel(e, toolNameById);
                return (
                <details
                  key={e.id}
                  className="rounded-lg border border-ink-100 bg-ink-50/50 dark:border-ink-800 dark:bg-ink-950/40"
                  style={{ marginLeft: Math.min(treeDepth(e.nodePath), 6) * 12 }}
                >
                  <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-ink-800 dark:text-ink-100">
                    <span className={clsx("mr-2 rounded px-1 py-0.5 text-[10px] font-bold", levelBadgeClass(e.level))}>
                      {e.level}
                    </span>
                    <span className="text-ink-500">#{e.sequence}</span> {toolLabel.title}
                    {toolLabel.toolFunctionId ? (
                      <span className="ml-2 font-mono text-[10px] text-ink-400">{toolLabel.toolFunctionId}</span>
                    ) : null}
                    <span className="ml-2 text-[10px] text-ink-400">{e.nodePath}</span>
                  </summary>
                  <div className="space-y-2 border-t border-ink-100 px-2 py-2 text-[11px] dark:border-ink-800">
                    <p className="whitespace-pre-wrap text-ink-800 dark:text-ink-200">{e.message}</p>
                    {e.inputContext != null ? (
                      <pre className="max-h-32 overflow-auto rounded bg-ink-950/90 p-2 font-mono text-ink-100">
                        {JSON.stringify(e.inputContext, null, 2)}
                      </pre>
                    ) : null}
                    {e.outputContext != null ? (
                      <pre className="max-h-32 overflow-auto rounded bg-ink-900/90 p-2 font-mono text-ink-100">
                        {JSON.stringify(e.outputContext, null, 2)}
                      </pre>
                    ) : null}
                    {e.stackTrace ? (
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-red-950/40 p-2 text-red-100">
                        {e.stackTrace}
                      </pre>
                    ) : null}
                    <p className="text-[10px] text-ink-400">{new Date(e.createdAt).toISOString()}</p>
                  </div>
                </details>
                );
              })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
