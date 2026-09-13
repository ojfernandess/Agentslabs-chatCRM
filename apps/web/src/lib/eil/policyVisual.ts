import { getFactLabel, getOpLabel, slugifyPolicyId } from "./catalog.js";
import { resolveActionLabel } from "./categoryCatalog.js";
import type { AgentEilConfigDraft, AgentEilPolicyDraft, EilCustomActionDef, FactValue } from "./types.js";

const UI_POLICY_KEYS = ["name", "description", "instruction", "active", "onUnknown", "onViolation", "idManuallyEdited"] as const;

export function serializePolicyForJson(policy: AgentEilPolicyDraft): AgentEilPolicyDraft {
  const out: AgentEilPolicyDraft = {
    id: policy.id,
    action: policy.action,
    requires: policy.requires,
    forbids: policy.forbids,
    blockWhenUnmet: policy.blockWhenUnmet,
  };
  for (const key of UI_POLICY_KEYS) {
    const val = policy[key];
    if (val !== undefined && val !== "" && val !== true) {
      (out as Record<string, unknown>)[key] = val;
    } else if (key === "active" && policy.active === false) {
      out.active = false;
    } else if (key === "idManuallyEdited" && policy.idManuallyEdited) {
      out.idManuallyEdited = true;
    }
  }
  if (policy.name?.trim()) out.name = policy.name.trim();
  if (policy.description?.trim()) out.description = policy.description.trim();
  if (policy.instruction?.trim()) out.instruction = policy.instruction.trim();
  return out;
}

export type OnUnknownMode = "fetch" | "ask" | "block" | "ignore";
export type OnViolationMode = "block" | "guide" | "escalate" | "alert" | "warn";

export function formatPredicate(pred: { fact: string; op: string; value?: FactValue }, locale: "pt" | "en"): string {
  const factLabel = getFactLabel(pred.fact, locale);
  const opLabel = getOpLabel(pred.op, locale);
  if (pred.op === "exists" || pred.op === "not_exists") return `${factLabel} ${opLabel}`;
  return `${factLabel} ${opLabel} ${String(pred.value ?? "")}`;
}

export function formatPolicySummary(
  policy: AgentEilPolicyDraft,
  locale: "pt" | "en",
  eilConfig?: AgentEilConfigDraft,
): {
  actionLabel: string;
  requiresLabel: string;
  forbidsLabel: string;
  failureLabel: string;
} {
  const actionLabel = policy.action ? resolveActionLabel(policy.action, locale, eilConfig) : "—";
  const requires = policy.requires ?? [];
  const forbids = policy.forbids ?? [];
  const requiresLabel =
    requires.length > 0 ? requires.map((p) => formatPredicate(p, locale)).join(locale === "pt" ? " E " : " AND ") : "—";
  const forbidsLabel =
    forbids.length > 0 ? forbids.map((p) => formatPredicate(p, locale)).join(locale === "pt" ? " OU " : " OR ") : "—";
  const failureLabel =
    policy.blockWhenUnmet === true
      ? locale === "pt"
        ? "Bloquear ação"
        : "Block action"
      : locale === "pt"
        ? "Bloquear ação"
        : "Block action";
  return { actionLabel, requiresLabel, forbidsLabel, failureLabel };
}

export function createEmptyPolicy(): AgentEilPolicyDraft {
  return {
    id: `policy_${Date.now()}`,
    action: "",
    requires: [],
    forbids: [],
    active: true,
    name: "",
    description: "",
    instruction: "",
    onUnknown: "fetch",
    onViolation: "block",
  };
}

export function policyFromTemplate(template: {
  id: string;
  namePt: string;
  nameEn: string;
  descriptionPt: string;
  descriptionEn: string;
  policy: {
    id: string;
    action: string;
    requires?: ReadonlyArray<{ fact: string; op: string; value?: FactValue }>;
    forbids?: ReadonlyArray<{ fact: string; op: string; value?: FactValue }>;
  };
}): AgentEilPolicyDraft {
  return {
    ...template.policy,
    requires: template.policy.requires ? [...template.policy.requires] : [],
    forbids: template.policy.forbids ? [...template.policy.forbids] : [],
    active: true,
    name: template.namePt,
    description: template.descriptionPt,
    onUnknown: "fetch",
    onViolation: "block",
  };
}

export function ensurePolicyId(policy: AgentEilPolicyDraft, locale: "pt" | "en"): AgentEilPolicyDraft {
  if (policy.id?.trim()) return policy;
  const base = policy.name?.trim() || (locale === "pt" ? "nova_politica" : "new_policy");
  return { ...policy, id: slugifyPolicyId(base) || `policy_${Date.now()}` };
}

function serializeCustomAction(action: EilCustomActionDef): EilCustomActionDef {
  const out: EilCustomActionDef = { id: action.id, label: action.label };
  if (action.description?.trim()) out.description = action.description.trim();
  if (action.enabled === false) out.enabled = false;
  if (action.detectionAliases?.length) out.detectionAliases = action.detectionAliases;
  return out;
}

/** Serializa config EIL completo (policies + category + customActions). */
export function eilConfigToJson(config: AgentEilConfigDraft): string {
  const out: Record<string, unknown> = {};
  if (config.category) out.category = config.category;
  if (config.customActions?.length) {
    out.customActions = config.customActions.map(serializeCustomAction);
  }
  out.policies = (config.policies ?? []).map(serializePolicyForJson);
  return JSON.stringify(out, null, 2);
}

export function policiesToJson(policies: AgentEilPolicyDraft[], meta?: Pick<AgentEilConfigDraft, "category" | "customActions">): string {
  return eilConfigToJson({ ...meta, policies });
}

export function parsePoliciesFromJson(json: string): AgentEilPolicyDraft[] {
  try {
    const parsed = JSON.parse(json || "{}") as { policies?: AgentEilPolicyDraft[] };
    return Array.isArray(parsed.policies) ? parsed.policies : [];
  } catch {
    return [];
  }
}
