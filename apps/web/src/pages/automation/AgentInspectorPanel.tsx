import type { ReactNode } from "react";
import clsx from "clsx";
import { CheckCircle2, Circle, Cpu, Gauge, Loader2, MessageSquare, ShieldCheck, Wrench, XCircle } from "lucide-react";

export type AgentInspectorData = {
  executionId: string;
  workflowKey: string;
  status: string;
  botName: string;
  conversationId: string | null;
  engine: {
    runtime: string;
    memory: string;
    supervisorEnabled: boolean;
    strictMode: boolean;
    observability: string;
  };
  model: string | null;
  provider: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userMessage: string | null;
  finalPromptPreview: string | null;
  replySent: string | null;
  tokens: { prompt?: number; completion?: number; total?: number } | null;
  tools: Array<{ name: string; ok: boolean | null; preview: string; at: string }>;
  supervisor: { approved: boolean | null; summary: string | null; level: string } | null;
  strictMode: {
    confidence: number | null;
    minConfidence: number;
    blocked: boolean;
    reasons: string[];
  } | null;
  memoryUsed: unknown;
  validationChecklist: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  timeline: Array<{ id: string; name: string; level: string; message: string; at: string }>;
};

function runtimeLabel(runtime: string, t: (key: string) => string): string {
  const key = `automationPage.agentEngineRuntime_${runtime}`;
  const translated = t(key);
  return translated === key ? runtime : translated;
}

function InspectorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white/90 dark:border-ink-700 dark:bg-ink-950/50">
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 dark:border-ink-800">
        {icon}
        <h4 className="text-xs font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">{title}</h4>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

export function AgentInspectorPanel({
  data,
  loading,
  error,
  t,
}: {
  data: AgentInspectorData | null;
  loading: boolean;
  error: boolean;
  t: (key: string) => string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("automationPage.agentInspectorLoading")}
      </div>
    );
  }
  if (error || !data) {
    return <p className="p-4 text-sm text-red-600 dark:text-red-400">{t("automationPage.agentInspectorError")}</p>;
  }

  const allChecksPassed = data.validationChecklist.every((c) => c.passed);

  return (
    <div className="space-y-3 p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs dark:border-violet-900/40 dark:bg-violet-950/30">
          <p className="font-semibold text-violet-900 dark:text-violet-100">{t("automationPage.agentInspectorEngine")}</p>
          <p className="mt-1 text-ink-700 dark:text-ink-300">
            {runtimeLabel(data.engine.runtime, t)} · {data.engine.memory}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-500">
            {data.provider ?? "—"} / {data.model ?? "—"}
            {data.durationMs != null ? ` · ${data.durationMs} ms` : ""}
          </p>
        </div>
        <div
          className={clsx(
            "rounded-lg border px-3 py-2 text-xs",
            allChecksPassed
              ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/30"
              : "border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/30",
          )}
        >
          <p className="font-semibold">{t("automationPage.agentInspectorChecklist")}</p>
          <ul className="mt-1 space-y-0.5">
            {data.validationChecklist.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5">
                {c.passed ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                )}
                <span>
                  {c.label}
                  {c.detail ? <span className="text-[10px] text-ink-500"> — {c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <InspectorSection
        title={t("automationPage.agentInspectorMessage")}
        icon={<MessageSquare className="h-4 w-4 text-sky-600" />}
      >
        <p className="whitespace-pre-wrap text-xs text-ink-800 dark:text-ink-200">
          {data.userMessage ?? t("automationPage.agentInspectorEmpty")}
        </p>
      </InspectorSection>

      {data.finalPromptPreview ? (
        <InspectorSection
          title={t("automationPage.agentInspectorPrompt")}
          icon={<Cpu className="h-4 w-4 text-violet-600" />}
        >
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-700 dark:text-ink-300">
            {data.finalPromptPreview}
          </pre>
        </InspectorSection>
      ) : null}

      {data.tools.length > 0 ? (
        <InspectorSection
          title={t("automationPage.agentInspectorTools")}
          icon={<Wrench className="h-4 w-4 text-emerald-600" />}
        >
          <ul className="space-y-2">
            {data.tools.map((tool, idx) => (
              <li key={`${tool.name}-${idx}`} className="rounded-lg border border-ink-100 px-2 py-1.5 dark:border-ink-800">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {tool.ok === true ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : tool.ok === false ? (
                    <XCircle className="h-3.5 w-3.5 text-red-600" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-ink-400" />
                  )}
                  {tool.name}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[10px] text-ink-600 dark:text-ink-400">{tool.preview}</p>
              </li>
            ))}
          </ul>
        </InspectorSection>
      ) : null}

      {data.supervisor ? (
        <InspectorSection
          title={t("automationPage.agentInspectorSupervisor")}
          icon={<ShieldCheck className="h-4 w-4 text-fuchsia-600" />}
        >
          <p className="text-xs font-semibold">
            {data.supervisor.approved === true
              ? t("automationPage.agentInspectorSupervisorApproved")
              : data.supervisor.approved === false
                ? t("automationPage.agentInspectorSupervisorRejected")
                : t("automationPage.agentInspectorSupervisorUnknown")}
          </p>
          {data.supervisor.summary ? (
            <p className="mt-1 whitespace-pre-wrap text-[10px] text-ink-600 dark:text-ink-400">{data.supervisor.summary}</p>
          ) : null}
        </InspectorSection>
      ) : null}

      {data.engine.strictMode || data.strictMode ? (
        <InspectorSection
          title={t("automationPage.agentInspectorStrictMode")}
          icon={<Gauge className="h-4 w-4 text-amber-600" />}
        >
          {data.strictMode?.confidence != null ? (
            <p
              className={clsx(
                "text-xs font-semibold",
                data.strictMode.blocked || data.strictMode.confidence < data.strictMode.minConfidence
                  ? "text-red-700 dark:text-red-300"
                  : "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {t("automationPage.agentInspectorStrictConfidence")
                .replace("{score}", String(data.strictMode.confidence))
                .replace("{min}", String(data.strictMode.minConfidence))}
            </p>
          ) : (
            <p className="text-xs text-ink-500">{t("automationPage.agentInspectorStrictPending")}</p>
          )}
          {data.strictMode?.blocked ? (
            <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
              {t("automationPage.agentInspectorStrictBlocked")}
            </p>
          ) : null}
          {data.strictMode?.reasons && data.strictMode.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] text-ink-600 dark:text-ink-400">
              {data.strictMode.reasons.slice(0, 6).map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </InspectorSection>
      ) : null}

      <InspectorSection
        title={t("automationPage.agentInspectorReply")}
        icon={<MessageSquare className="h-4 w-4 text-brand-600" />}
      >
        <p className="whitespace-pre-wrap text-xs text-ink-800 dark:text-ink-200">
          {data.replySent ?? t("automationPage.agentInspectorEmpty")}
        </p>
        {data.tokens ? (
          <p className="mt-2 text-[10px] text-ink-500">
            {t("automationPage.agentInspectorTokens")
              .replace("{prompt}", String(data.tokens.prompt ?? "—"))
              .replace("{completion}", String(data.tokens.completion ?? "—"))
              .replace("{total}", String(data.tokens.total ?? "—"))}
          </p>
        ) : null}
      </InspectorSection>

      <InspectorSection
        title={t("automationPage.agentInspectorTimeline")}
        icon={<Cpu className="h-4 w-4 text-ink-500" />}
      >
        <ol className="max-h-48 space-y-1 overflow-y-auto">
          {data.timeline.map((step, idx) => (
            <li key={`${step.id}-${idx}`} className="flex gap-2 text-[10px]">
              <span className="shrink-0 font-mono text-ink-400">{new Date(step.at).toLocaleTimeString()}</span>
              <span className="font-semibold text-ink-700 dark:text-ink-300">{step.name}</span>
              <span className="truncate text-ink-500">{step.message.slice(0, 80)}</span>
            </li>
          ))}
        </ol>
      </InspectorSection>
    </div>
  );
}
