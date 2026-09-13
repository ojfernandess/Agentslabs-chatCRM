/**
 * Avaliação de políticas EIL para o simulador da UI.
 * Espelha PolicyEngine.ts — não duplicar lógica de domínio.
 */

import type { AgentEilPolicyDraft, EilPredicateDraft, FactValue } from "./types.js";

export type { FactValue };
export type FactStore = Record<string, { value?: FactValue; source?: string }>;
export type FactPredicate = EilPredicateDraft;

export type EilPolicyEval = {
  id: string;
  action?: string;
  requires?: FactPredicate[];
  forbids?: FactPredicate[];
  blockWhenUnmet?: boolean;
  active?: boolean;
};

export type ConstraintViolation = {
  policyId: string;
  action?: string;
  reason: string;
  predicates: FactPredicate[];
};

export type PredicateEvalResult = {
  fact: string;
  op: string;
  expected?: FactValue;
  actual?: FactValue;
  exists: boolean;
  result: "true" | "false" | "unknown";
};

function hasFact(store: FactStore, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(store, key) && store[key]?.value !== undefined;
}

function toNumber(v: FactValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

export function evaluatePredicateDetailed(store: FactStore, pred: FactPredicate): PredicateEvalResult {
  const fact = store[pred.fact];
  const exists = hasFact(store, pred.fact);
  const actual = fact?.value;

  if (pred.op === "exists") {
    return { fact: pred.fact, op: pred.op, actual, exists, result: exists ? "true" : "false" };
  }
  if (pred.op === "not_exists") {
    return { fact: pred.fact, op: pred.op, actual, exists, result: !exists ? "true" : "false" };
  }
  if (!exists) {
    return { fact: pred.fact, op: pred.op, expected: pred.value, actual, exists: false, result: "unknown" };
  }

  let result: boolean;
  switch (pred.op) {
    case "eq":
      result = actual === pred.value;
      break;
    case "neq":
      result = actual !== pred.value;
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = toNumber(actual);
      const right = toNumber(pred.value ?? null);
      if (left == null || right == null) {
        return { fact: pred.fact, op: pred.op, expected: pred.value, actual, exists: true, result: "unknown" };
      }
      if (pred.op === "gt") result = left > right;
      else if (pred.op === "gte") result = left >= right;
      else if (pred.op === "lt") result = left < right;
      else result = left <= right;
      break;
    }
    default:
      return { fact: pred.fact, op: pred.op, expected: pred.value, actual, exists: true, result: "unknown" };
  }

  return { fact: pred.fact, op: pred.op, expected: pred.value, actual, exists: true, result: result ? "true" : "false" };
}

export function evaluatePredicate(store: FactStore, pred: FactPredicate): boolean {
  const d = evaluatePredicateDetailed(store, pred);
  if (d.result === "unknown") return false;
  return d.result === "true";
}

function allPredicatesPass(store: FactStore, preds: FactPredicate[] | undefined): boolean {
  if (!preds || preds.length === 0) return true;
  return preds.every((p) => evaluatePredicate(store, p));
}

export function evaluatePolicies(input: {
  policies: EilPolicyEval[];
  facts: FactStore;
  replyActions: string[];
}): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const actions = new Set(input.replyActions.map(String));

  for (const policy of input.policies) {
    if (policy.active === false) continue;

    if (policy.action) {
      if (!actions.has(policy.action)) continue;

      if (policy.requires && policy.requires.length > 0) {
        if (!allPredicatesPass(input.facts, policy.requires)) {
          violations.push({
            policyId: policy.id,
            action: policy.action,
            reason: `Action "${policy.action}" requires unmet fact predicates`,
            predicates: policy.requires,
          });
        }
      }
      if (policy.forbids && policy.forbids.length > 0) {
        const forbiddenTrue = policy.forbids.some((p) => evaluatePredicate(input.facts, p));
        if (forbiddenTrue) {
          violations.push({
            policyId: policy.id,
            action: policy.action,
            reason: `Action "${policy.action}" forbidden by fact predicates`,
            predicates: policy.forbids,
          });
        }
      }
    }
  }

  return violations;
}

export function toEilPolicyEval(policy: AgentEilPolicyDraft): EilPolicyEval {
  return {
    id: policy.id,
    action: policy.action,
    requires: policy.requires,
    forbids: policy.forbids,
    blockWhenUnmet: policy.blockWhenUnmet,
    active: policy.active,
  };
}

export function buildFactStoreFromInputs(inputs: Record<string, string>): FactStore {
  const store: FactStore = {};
  for (const [key, raw] of Object.entries(inputs)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed === "true") store[key] = { value: true };
    else if (trimmed === "false") store[key] = { value: false };
    else if (!Number.isNaN(Number(trimmed)) && trimmed !== "") store[key] = { value: Number(trimmed) };
    else store[key] = { value: trimmed };
  }
  return store;
}
