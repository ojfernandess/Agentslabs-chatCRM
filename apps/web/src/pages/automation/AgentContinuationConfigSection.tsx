import { useMemo } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Loader2, PlayCircle } from "lucide-react";

/** Exemplo Auda Passo 8 — qualquer segmento pode editar ou adicionar regras. */
export const DEFAULT_AGENT_CONTINUATION_RULES = [
  {
    id: "post_checkin_passo8",
    name: "Passo 8 — detalhes da estadia após check-in",
    enabled: true,
    trigger: "after_reply" as const,
    when: {
      toolCalled: "audaar_check_in",
      toolOk: true,
      resultDelivered: true,
    },
    delaySeconds: 4,
    maxPerConversation: 1,
    turnHint:
      "[Continuação automática — Passo 8] O check-in foi concluído com sucesso no turno anterior. " +
      "Execute Passo 8 do playbook: (A) audaar_consultar_reserva com o mesmo localizador; " +
      "(B) até 4× buscar_conhecimento (endereço, entrada, wifi, políticas); " +
      "(C) envie a mensagem completa de conclusão ao hóspede. " +
      "NÃO chame audaar_check_in novamente neste turno. NÃO transfira para humano.",
  },
] as const;

export const DEFAULT_AGENT_CONTINUATION_JSON = JSON.stringify(
  { enabled: true, rules: DEFAULT_AGENT_CONTINUATION_RULES },
  null,
  2,
);

export type AgentContinuationWhenDraft = {
  toolCalled?: string;
  toolOk?: boolean;
  flowStep?: string;
  resultDelivered?: boolean;
  replyContains?: string;
  replyMinChars?: number;
};

export type AgentContinuationRuleDraft = {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: "after_reply" | "after_tool_round";
  when?: AgentContinuationWhenDraft;
  delaySeconds?: number;
  maxPerConversation?: number;
  turnHint: string;
};

export type AgentContinuationConfigDraft = {
  enabled?: boolean;
  rules?: AgentContinuationRuleDraft[];
};

export type ParsedAgentContinuationResult =
  | {
      ok: true;
      value: AgentContinuationConfigDraft;
      summary: { rules: number; ruleIds: string[] };
    }
  | { ok: false; error: string };

function parseWhen(raw: unknown): AgentContinuationWhenDraft | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const when: AgentContinuationWhenDraft = {};
  if (typeof o.toolCalled === "string" && o.toolCalled.trim()) when.toolCalled = o.toolCalled.trim();
  if (typeof o.toolOk === "boolean") when.toolOk = o.toolOk;
  if (typeof o.flowStep === "string" && o.flowStep.trim()) when.flowStep = o.flowStep.trim();
  if (typeof o.resultDelivered === "boolean") when.resultDelivered = o.resultDelivered;
  if (typeof o.replyContains === "string" && o.replyContains.trim()) when.replyContains = o.replyContains.trim();
  if (typeof o.replyMinChars === "number" && Number.isFinite(o.replyMinChars)) {
    when.replyMinChars = Math.floor(o.replyMinChars);
  }
  return when;
}

/** Valida JSON de `behaviorConfig.agentContinuation`. */
export function parseAgentContinuationJson(raw: string): ParsedAgentContinuationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "object" };
  }
  const obj = parsed as Record<string, unknown>;
  const out: AgentContinuationConfigDraft = {};

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    return { ok: false, error: "enabled" };
  }
  if (obj.enabled !== undefined) out.enabled = obj.enabled;

  if (obj.rules === undefined) {
    out.rules = [];
  } else if (!Array.isArray(obj.rules)) {
    return { ok: false, error: "rules" };
  } else {
    const rules: AgentContinuationRuleDraft[] = [];
    for (const item of obj.rules) {
      if (!item || typeof item !== "object") return { ok: false, error: "rule" };
      const ro = item as Record<string, unknown>;
      const id = typeof ro.id === "string" ? ro.id.trim() : "";
      if (!id) return { ok: false, error: "ruleId" };
      const trigger = ro.trigger;
      if (trigger !== "after_reply" && trigger !== "after_tool_round") {
        return { ok: false, error: "trigger" };
      }
      const turnHint = typeof ro.turnHint === "string" ? ro.turnHint.trim() : "";
      if (turnHint.length < 8) return { ok: false, error: "turnHint" };
      const when = parseWhen(ro.when);
      if (when === null) return { ok: false, error: "when" };
      rules.push({
        id,
        name: typeof ro.name === "string" ? ro.name.trim() : undefined,
        enabled: ro.enabled === false ? false : undefined,
        trigger,
        when,
        delaySeconds:
          typeof ro.delaySeconds === "number" && Number.isFinite(ro.delaySeconds)
            ? Math.floor(ro.delaySeconds)
            : undefined,
        maxPerConversation:
          typeof ro.maxPerConversation === "number" && Number.isFinite(ro.maxPerConversation)
            ? Math.floor(ro.maxPerConversation)
            : undefined,
        turnHint,
      });
    }
    out.rules = rules;
  }

  const ruleIds = (out.rules ?? []).map((r) => r.id);
  return { ok: true, value: out, summary: { rules: ruleIds.length, ruleIds } };
}

export function extractAgentContinuation(
  behaviorConfig: Record<string, unknown> | undefined | null,
): AgentContinuationConfigDraft | null {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return null;
  const raw = behaviorConfig.agentContinuation;
  if (!raw || typeof raw !== "object") return null;
  return raw as AgentContinuationConfigDraft;
}

export function agentContinuationIsActive(
  behaviorConfig: Record<string, unknown> | undefined | null,
): boolean {
  const cfg = extractAgentContinuation(behaviorConfig);
  if (!cfg) return false;
  if (cfg.enabled === false) return false;
  return (cfg.rules ?? []).some((r) => r.enabled !== false);
}

export function agentContinuationRulesToJson(cfg: AgentContinuationConfigDraft | null): string {
  if (!cfg?.rules?.length) return DEFAULT_AGENT_CONTINUATION_JSON;
  return JSON.stringify({ enabled: cfg.enabled !== false, rules: cfg.rules }, null, 2);
}

export function buildAgentContinuationForPayload(
  enabled: boolean,
  json: string,
): AgentContinuationConfigDraft | null {
  const parsed = parseAgentContinuationJson(json);
  if (!parsed.ok) return enabled ? null : null;
  const rules = parsed.value.rules ?? [];
  if (!enabled) {
    if (rules.length === 0) return null;
    return { enabled: false, rules };
  }
  return { enabled: true, rules };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: Translate;
  editBotId: string | null;
  onApplyTemplate?: () => Promise<void>;
  applyingTemplate?: boolean;
  lastApplySummary?: { ruleIds: string[]; templateId: string } | null;
};

export function AgentContinuationConfigSection({
  enabled,
  onEnabledChange,
  json,
  onJsonChange,
  t,
  editBotId,
  onApplyTemplate,
  applyingTemplate,
  lastApplySummary,
}: Props) {
  const parsed = useMemo(() => (enabled ? parseAgentContinuationJson(json) : null), [enabled, json]);

  const validationMessage = (() => {
    if (!enabled || !parsed) return null;
    if (parsed.ok) return null;
    const map: Record<string, string> = {
      json: t("automationPage.agentContinuationInvalidJson"),
      object: t("automationPage.agentContinuationMustBeObject"),
      enabled: t("automationPage.agentContinuationInvalidEnabled"),
      rules: t("automationPage.agentContinuationInvalidRules"),
      rule: t("automationPage.agentContinuationInvalidRule"),
      ruleId: t("automationPage.agentContinuationInvalidRuleId"),
      trigger: t("automationPage.agentContinuationInvalidTrigger"),
      turnHint: t("automationPage.agentContinuationInvalidTurnHint"),
      when: t("automationPage.agentContinuationInvalidWhen"),
    };
    return map[parsed.error] ?? t("automationPage.agentContinuationInvalidJson");
  })();

  return (
    <div className="rounded-xl border border-sky-200/80 bg-sky-50/40 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">
            {t("automationPage.agentContinuationTitle")}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
            {t("automationPage.agentContinuationHelp")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              const next = e.target.checked;
              onEnabledChange(next);
              if (next && !json.trim()) {
                onJsonChange(DEFAULT_AGENT_CONTINUATION_JSON);
              }
            }}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
          />
          {t("automationPage.agentContinuationEnable")}
        </label>
      </div>

      {enabled ? (
        <>
          <label className="mt-3 block text-[11px] font-medium text-ink-700 dark:text-ink-300">
            {t("automationPage.agentContinuationJsonLabel")}
            <textarea
              value={json}
              onChange={(e) => onJsonChange(e.target.value)}
              rows={14}
              spellCheck={false}
              className={clsx(
                "mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed dark:bg-ink-950 dark:text-ink-100",
                validationMessage
                  ? "border-red-300 dark:border-red-800"
                  : "border-ink-200 dark:border-ink-600",
              )}
            />
          </label>

          {validationMessage ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              {validationMessage}
            </p>
          ) : parsed?.ok ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {t("automationPage.agentContinuationValid")} — {parsed.summary.rules}{" "}
              {t("automationPage.agentContinuationSummaryRules")}: {parsed.summary.ruleIds.join(", ")}
            </p>
          ) : null}

          {editBotId && onApplyTemplate ? (
            <div className="mt-3 rounded-lg border border-sky-100 bg-white/70 p-3 dark:border-sky-900/40 dark:bg-ink-900/30">
              <p className="text-[11px] font-medium text-ink-800 dark:text-ink-200">
                {t("automationPage.agentContinuationApplyTemplate")}
              </p>
              <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-400">
                {t("automationPage.agentContinuationApplyTemplateHelp")}
              </p>
              <button
                type="button"
                disabled={applyingTemplate}
                onClick={() => void onApplyTemplate()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {applyingTemplate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                {t("automationPage.agentContinuationApplyTemplateBtn")}
              </button>
              {lastApplySummary ? (
                <p className="mt-2 text-[10px] text-emerald-700 dark:text-emerald-400">
                  {t("automationPage.agentContinuationApplyDone", {
                    rules: lastApplySummary.ruleIds.join(", "),
                    template: lastApplySummary.templateId,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
