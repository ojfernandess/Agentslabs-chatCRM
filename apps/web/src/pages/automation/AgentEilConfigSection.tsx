import { buildEilHelpSections } from "@/lib/eil/helpSections.js";
import { coerceFactValue, type AgentEilConfigDraft, type AgentEilPolicyDraft, type EilPredicateDraft } from "@/lib/eil/types.js";
import type { AutomationCustomToolRow } from "./automationToolTypes.js";
import { AgentEilPolicyBuilder } from "./eil/AgentEilPolicyBuilder.js";

export type { AgentEilConfigDraft, AgentEilPolicyDraft } from "@/lib/eil/types.js";

/** Política padrão usada apenas pelo botão «Aplicar modelo padrão», não ao ativar EIL. */
export const DEFAULT_AGENT_EIL_POLICIES = [
  {
    id: "party_requires_n_gt_1",
    action: "request_additional_party",
    requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
  },
] as const;

export const DEFAULT_AGENT_EIL_JSON = JSON.stringify({ policies: DEFAULT_AGENT_EIL_POLICIES }, null, 2);

export const EMPTY_AGENT_EIL_JSON = JSON.stringify({ policies: [] }, null, 2);

const VALID_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "exists", "not_exists"]);

function parsePredicates(raw: unknown): AgentEilPolicyDraft["requires"] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: NonNullable<AgentEilPolicyDraft["requires"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const fact = typeof o.fact === "string" ? o.fact.trim() : "";
    const op = typeof o.op === "string" ? o.op.trim() : "";
    if (!fact || !VALID_OPS.has(op)) return null;
    const pred: EilPredicateDraft = { fact, op };
    if ("value" in o) {
      const coerced = coerceFactValue(o.value);
      if (coerced !== undefined) pred.value = coerced;
    }
    out.push(pred);
  }
  return out;
}

function readUiPolicyFields(po: Record<string, unknown>): Partial<AgentEilPolicyDraft> {
  const ui: Partial<AgentEilPolicyDraft> = {};
  if (typeof po.name === "string") ui.name = po.name;
  if (typeof po.description === "string") ui.description = po.description;
  if (typeof po.instruction === "string") ui.instruction = po.instruction;
  if (po.active === false) ui.active = false;
  if (po.onUnknown === "fetch" || po.onUnknown === "ask" || po.onUnknown === "block" || po.onUnknown === "ignore") {
    ui.onUnknown = po.onUnknown;
  }
  if (
    po.onViolation === "block" ||
    po.onViolation === "guide" ||
    po.onViolation === "escalate" ||
    po.onViolation === "alert" ||
    po.onViolation === "warn"
  ) {
    ui.onViolation = po.onViolation;
  }
  if (po.idManuallyEdited === true) ui.idManuallyEdited = true;
  return ui;
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
      const requires = parsePredicates(po.requires);
      if (requires === null) return { ok: false, error: "requires" };
      const forbids = parsePredicates(po.forbids);
      if (forbids === null) return { ok: false, error: "forbids" };
      policies.push({
        id,
        action: typeof po.action === "string" ? po.action.trim() : undefined,
        requires,
        forbids,
        blockWhenUnmet: po.blockWhenUnmet === true ? true : undefined,
        ...readUiPolicyFields(po),
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
  if (!eil?.policies?.length) return EMPTY_AGENT_EIL_JSON;
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
  locale: "pt" | "en";
  tools: AutomationCustomToolRow[];
  connectedToolNames: string[];
  editBotId: string | null;
  onApplyDefault?: () => Promise<void>;
  applyingDefault?: boolean;
  lastApplySummary?: { toolsUpdated: number; policyIds: string[] } | null;
};

export function AgentEilConfigSection(props: Props) {
  const helpSections = buildEilHelpSections(props.t);
  return <AgentEilPolicyBuilder {...props} helpSections={helpSections} />;
}
