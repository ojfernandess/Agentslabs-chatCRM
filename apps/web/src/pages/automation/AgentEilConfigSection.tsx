import { useMemo } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Loader2, Sparkles } from "lucide-react";

/** Alinhado com DEFAULT_ADDITIONAL_PARTY_EIL em applyEilConfig.ts */
export const DEFAULT_AGENT_EIL_POLICIES = [
  {
    id: "party_requires_n_gt_1",
    action: "request_additional_party",
    requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
  },
] as const;

export const DEFAULT_AGENT_EIL_JSON = JSON.stringify(
  { policies: DEFAULT_AGENT_EIL_POLICIES },
  null,
  2,
);

export type AgentEilPolicyDraft = {
  id: string;
  action?: string;
  requires?: Array<{ fact: string; op: string; value?: unknown }>;
  forbids?: Array<{ fact: string; op: string; value?: unknown }>;
  blockWhenUnmet?: boolean;
};

export type AgentEilConfigDraft = {
  enabled?: boolean;
  policies?: AgentEilPolicyDraft[];
};

const VALID_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "exists", "not_exists"]);

function parsePredicates(raw: unknown, field: string): AgentEilPolicyDraft["requires"] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: NonNullable<AgentEilPolicyDraft["requires"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const fact = typeof o.fact === "string" ? o.fact.trim() : "";
    const op = typeof o.op === "string" ? o.op.trim() : "";
    if (!fact || !VALID_OPS.has(op)) return null;
    const pred: { fact: string; op: string; value?: unknown } = { fact, op };
    if ("value" in o) pred.value = o.value;
    out.push(pred);
  }
  return out;
}

export type ParsedAgentEilResult =
  | { ok: true; value: AgentEilConfigDraft; summary: { policies: number; policyIds: string[] } }
  | { ok: false; error: string };

/** Valida JSON de `behaviorConfig.eil` (políticas declarativas). */
export function parseAgentEilJson(raw: string): ParsedAgentEilResult {
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
  const out: AgentEilConfigDraft = {};

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    return { ok: false, error: "enabled" };
  }
  if (obj.enabled !== undefined) out.enabled = obj.enabled;

  if (obj.policies === undefined) {
    out.policies = [];
  } else if (!Array.isArray(obj.policies)) {
    return { ok: false, error: "policies" };
  } else {
    const policies: AgentEilPolicyDraft[] = [];
    for (const p of obj.policies) {
      if (!p || typeof p !== "object") return { ok: false, error: "policy" };
      const po = p as Record<string, unknown>;
      const id = typeof po.id === "string" ? po.id.trim() : "";
      if (!id) return { ok: false, error: "policyId" };
      const requires = parsePredicates(po.requires, "requires");
      if (requires === null) return { ok: false, error: "requires" };
      const forbids = parsePredicates(po.forbids, "forbids");
      if (forbids === null) return { ok: false, error: "forbids" };
      policies.push({
        id,
        action: typeof po.action === "string" ? po.action.trim() : undefined,
        requires,
        forbids,
        blockWhenUnmet: po.blockWhenUnmet === true ? true : undefined,
      });
    }
    out.policies = policies;
  }

  const policyIds = (out.policies ?? []).map((p) => p.id);
  return {
    ok: true,
    value: out,
    summary: { policies: policyIds.length, policyIds },
  };
}

export function extractAgentEil(behaviorConfig: Record<string, unknown> | undefined | null): AgentEilConfigDraft | null {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return null;
  const raw = behaviorConfig.eil;
  if (!raw || typeof raw !== "object") return null;
  return raw as AgentEilConfigDraft;
}

export function agentEilIsActive(behaviorConfig: Record<string, unknown> | undefined | null): boolean {
  const eil = extractAgentEil(behaviorConfig);
  if (!eil) return false;
  return eil.enabled !== false;
}

/** Serializa policies para o editor (sem duplicar enabled — vem do checkbox). */
export function agentEilPoliciesToJson(eil: AgentEilConfigDraft | null): string {
  if (!eil?.policies?.length) return DEFAULT_AGENT_EIL_JSON;
  return JSON.stringify({ policies: eil.policies }, null, 2);
}

/** Monta `behaviorConfig.eil` para persistência. */
export function buildAgentEilForPayload(enabled: boolean, json: string): AgentEilConfigDraft | null {
  const parsed = parseAgentEilJson(json);
  if (!parsed.ok) return enabled ? null : null;
  const policies = parsed.value.policies ?? [];
  if (!enabled) {
    if (policies.length === 0) return null;
    return { enabled: false, policies };
  }
  return { enabled: true, policies };
}

type Translate = (key: string) => string;

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: Translate;
  editBotId: string | null;
  onApplyDefault?: () => Promise<void>;
  applyingDefault?: boolean;
  lastApplySummary?: { toolsUpdated: number; policyIds: string[] } | null;
};

export function AgentEilConfigSection({
  enabled,
  onEnabledChange,
  json,
  onJsonChange,
  t,
  editBotId,
  onApplyDefault,
  applyingDefault,
  lastApplySummary,
}: Props) {
  const parsed = useMemo(() => (enabled ? parseAgentEilJson(json) : null), [enabled, json]);

  const validationMessage = (() => {
    if (!enabled || !parsed) return null;
    if (parsed.ok) return null;
    const map: Record<string, string> = {
      json: t("automationPage.agentEilInvalidJson"),
      object: t("automationPage.agentEilMustBeObject"),
      enabled: t("automationPage.agentEilInvalidEnabled"),
      policies: t("automationPage.agentEilInvalidPolicies"),
      policy: t("automationPage.agentEilInvalidPolicy"),
      policyId: t("automationPage.agentEilInvalidPolicyId"),
      requires: t("automationPage.agentEilInvalidRequires"),
      forbids: t("automationPage.agentEilInvalidForbids"),
    };
    return map[parsed.error] ?? t("automationPage.agentEilInvalidJson");
  })();

  return (
    <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{t("automationPage.agentEilTitle")}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
            {t("automationPage.agentEilHelp")}
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
                onJsonChange(DEFAULT_AGENT_EIL_JSON);
              }
            }}
          />
          {t("automationPage.agentEilEnable")}
        </label>
      </div>

      {editBotId && onApplyDefault ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={applyingDefault}
            onClick={() => void onApplyDefault()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-950/60"
          >
            {applyingDefault ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("automationPage.agentEilApplyDefault")}
          </button>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">{t("automationPage.agentEilApplyDefaultHelp")}</p>
        </div>
      ) : null}

      {lastApplySummary ? (
        <p className="mt-2 text-[11px] text-emerald-800 dark:text-emerald-200">
          {t("automationPage.agentEilApplyDone")
            .replace("{tools}", String(lastApplySummary.toolsUpdated))
            .replace("{policies}", lastApplySummary.policyIds.join(", ") || "—")}
        </p>
      ) : null}

      {enabled ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {t("automationPage.agentEilJsonLabel")}
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  onJsonChange(JSON.stringify(JSON.parse(json || "{}"), null, 2));
                } catch {
                  /* validation below */
                }
              }}
              className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("automationPage.toolsJsonBeautify")}
            </button>
          </div>
          <textarea
            value={json}
            onChange={(e) => onJsonChange(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
          />

          {validationMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{validationMessage}</span>
            </div>
          ) : parsed?.ok ? (
            <div
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs",
                "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("automationPage.agentEilValid")}
              </div>
              <p className="mt-2">
                {t("automationPage.agentEilSummaryPolicies")}: {parsed.summary.policies}
                {parsed.summary.policyIds.length > 0 ? ` (${parsed.summary.policyIds.join(", ")})` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
