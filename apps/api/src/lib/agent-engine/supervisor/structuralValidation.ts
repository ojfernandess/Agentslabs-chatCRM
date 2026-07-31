import type { ExecutionContract } from "../core/types.js";
import type { ExecutionIntelligencePlan, FactStore } from "../eil/types.js";
import { hasFact } from "../eil/FactsEngine.js";
import { detectReplyActions } from "../eil/detectReplyActions.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { isLikelyMutableOrCompletionTool } from "../validators/turnPolicyParser.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";

export type StructuralValidationInput = {
  replyText: string;
  toolOutcomes: Array<{ name: string; ok?: boolean }>;
  executionContract?: ExecutionContract | null;
  eilPlan?: ExecutionIntelligencePlan;
  turnPolicy?: TurnPolicy | null;
  facts?: FactStore;
  strictMode?: boolean;
};

/** Resposta afirma conclusão de fluxo (via detectReplyActions — não regex disperso). */
export function replyClaimsFlowCompletion(replyText: string): boolean {
  return detectReplyActions(replyText).includes("complete_flow");
}

/** Resposta afirma dados operacionais sem tool neste turno. */
export function replyClaimsOperationalData(replyText: string): boolean {
  return detectReplyActions(replyText).includes("assert_operational_data");
}

export function completionToolRan(
  toolOutcomes: Array<{ name: string; ok?: boolean }>,
  turnPolicy?: TurnPolicy | null,
): boolean {
  const hints = turnPolicy?.completionToolHints ?? [];
  return toolOutcomes.some(
    (t) =>
      t.ok !== false &&
      (hints.some((h) => toolOutcomeSatisfiesRequired(h, [t])) ||
        isLikelyMutableOrCompletionTool(t.name, hints)),
  );
}

/** Facts satisfazem pre-conditions do contrato/plano. */
export function factsSatisfyPreconditions(input: StructuralValidationInput): boolean {
  const contract = input.executionContract;
  const plan = input.eilPlan;
  const facts = input.facts ?? {};
  const requiredFacts = contract?.requiredFacts ?? plan?.requiredFacts ?? [];
  if (requiredFacts.length === 0) return true;
  return requiredFacts.every((f) => hasFact(facts, f));
}

/** Completion criteria do contrato atingidos. */
export function completionCriteriaMet(input: StructuralValidationInput): boolean {
  const contract = input.executionContract;
  if (!contract) return true;
  if (contract.completionCriteria.includes("required_tools_satisfied")) {
    return contract.pendingToolNames.length === 0 && contract.valid;
  }
  if (replyClaimsFlowCompletion(input.replyText) && !completionToolRan(input.toolOutcomes, input.turnPolicy)) {
    return false;
  }
  return contract.pendingToolNames.length === 0;
}

/** Sem afirmar conclusão operacional sem tool de conclusão OK. */
export function noCompletionClaimWithoutTool(input: StructuralValidationInput): boolean {
  if (!replyClaimsFlowCompletion(input.replyText)) return true;
  return completionToolRan(input.toolOutcomes, input.turnPolicy);
}

/** Resposta substantiva após tool de conclusão (strict). */
export function completionReplySubstantive(input: StructuralValidationInput): boolean {
  if (!completionToolRan(input.toolOutcomes, input.turnPolicy)) return true;
  const t = input.replyText.trim();
  if (t.length >= 120) return true;
  if (replyClaimsFlowCompletion(t)) return true;
  return !input.strictMode;
}
