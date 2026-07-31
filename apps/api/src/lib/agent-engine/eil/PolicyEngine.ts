import { hasFact } from "./FactsEngine.js";
import type {
  ConstraintViolation,
  EilPolicy,
  FactPredicate,
  FactStore,
  FactValue,
  ReplyActionId,
} from "./types.js";
import type { PolicyRule } from "../contract/PolicyTypes.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";

function toNumber(v: FactValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Avalia um predicado genérico contra o FactStore. */
export function evaluatePredicate(store: FactStore, pred: FactPredicate): boolean {
  const fact = store[pred.fact];
  const exists = hasFact(store, pred.fact);

  switch (pred.op) {
    case "exists":
      return exists;
    case "not_exists":
      return !exists;
    case "eq":
      return exists && fact.value === pred.value;
    case "neq":
      return exists && fact.value !== pred.value;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = toNumber(fact?.value);
      const right = toNumber(pred.value ?? null);
      if (left == null || right == null) return false;
      if (pred.op === "gt") return left > right;
      if (pred.op === "gte") return left >= right;
      if (pred.op === "lt") return left < right;
      return left <= right;
    }
    default:
      return false;
  }
}

function allPredicatesPass(store: FactStore, preds: FactPredicate[] | undefined): boolean {
  if (!preds || preds.length === 0) return true;
  return preds.every((p) => evaluatePredicate(store, p));
}

function anyPredicateFails(store: FactStore, preds: FactPredicate[] | undefined): boolean {
  if (!preds || preds.length === 0) return false;
  return preds.some((p) => !evaluatePredicate(store, p));
}

export type EvaluatePoliciesInput = {
  policies: EilPolicy[];
  facts: FactStore;
  /** Acções detectadas no reply. */
  replyActions: ReplyActionId[] | string[];
};

/**
 * Policy Engine — interpreta constraints declarativas.
 * Nunca contém IFs de domínio; só predicados + actions.
 */
export function evaluatePolicies(input: EvaluatePoliciesInput): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const actions = new Set(input.replyActions.map(String));

  for (const policy of input.policies) {
    // Policy scoped to an action: only apply when that action is present
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
        // forbids: if any forbid predicate is TRUE, violation
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
      continue;
    }

    // Global requires (must hold regardless of action)
    if (policy.requires && anyPredicateFails(input.facts, policy.requires) && policy.blockWhenUnmet) {
      violations.push({
        policyId: policy.id,
        reason: "Required fact predicates unmet",
        predicates: policy.requires,
      });
    }
    if (policy.forbids) {
      const forbiddenTrue = policy.forbids.some((p) => evaluatePredicate(input.facts, p));
      if (forbiddenTrue) {
        violations.push({
          policyId: policy.id,
          reason: "Forbidden fact predicates matched",
          predicates: policy.forbids,
        });
      }
    }
  }

  return violations;
}

/** Acções proibidas pelo conjunto de policies dado o FactStore actual. */
export function resolveForbiddenActions(
  policies: EilPolicy[],
  facts: FactStore,
): string[] {
  const forbidden: string[] = [];
  for (const policy of policies) {
    if (!policy.action) continue;
    if (!policy.requires || policy.requires.length === 0) continue;
    // Se requires não passam, a action fica proibida
    if (!allPredicatesPass(facts, policy.requires)) {
      forbidden.push(policy.action);
    }
  }
  return [...new Set(forbidden)];
}

export type PromptIrPolicyEvaluation = {
  violations: string[];
  blockedSameTurnPairs: Array<{ a: string; b: string }>;
};

/**
 * Policy Engine v2 — avalia PolicyRule[] do Prompt IR (Fase 3).
 * Sem IFs de domínio; só kinds declarativos do IR.
 */
export function evaluatePromptIrPolicyRules(opts: {
  rules: PolicyRule[];
  facts: FactStore;
  toolsCalledThisTurn: string[];
  turnPolicy: TurnPolicy;
}): PromptIrPolicyEvaluation {
  const violations: string[] = [];
  const blockedSameTurnPairs: Array<{ a: string; b: string }> = [];
  const called = opts.toolsCalledThisTurn.map((t) => t.toLowerCase());

  for (const rule of opts.rules) {
    if (rule.kind === "forbidden_same_turn_pair" && rule.pair) {
      const a = rule.pair.a.toLowerCase();
      const b = rule.pair.b.toLowerCase();
      if (called.includes(a) && called.includes(b)) {
        violations.push(`forbidden_same_turn:${a}+${b}`);
        blockedSameTurnPairs.push({ a: rule.pair.a, b: rule.pair.b });
      }
    }
    if (rule.kind === "block_escalation_on_confirmation" && opts.turnPolicy.blockEscalation) {
      for (const t of ["transfer_to_team", "call_human", "set_conversation_status"]) {
        if (called.includes(t)) {
          violations.push(`escalation_blocked_on_confirmation:${t}`);
        }
      }
    }
    if (rule.kind === "omit_tool_when_slots_present" && rule.slotKeys?.length) {
      const allPresent = rule.slotKeys.every((k) => hasFact(opts.facts, k));
      if (!allPresent && rule.tools?.length) {
        /* informativo — scheduler usa turnPolicy.omitToolsWhenSlotsPresent */
      }
    }
  }

  return { violations, blockedSameTurnPairs };
}
