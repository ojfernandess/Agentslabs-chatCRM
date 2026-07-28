/**
 * Execution Consistency — compara plano esperado × executado após cada tool.
 */

import { pendingRequiredToolNames } from "../contract/TurnExecutionContract.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import {
  findForbiddenPairViolation,
  isSkippedToolOutcome,
  validateToolOutcomesAgainstTurnPolicy,
} from "../validators/turnPolicyParser.js";
import { planToolRecovery } from "./ToolRecovery.js";
import type {
  ExecutionConsistencyResult,
  ExecutionContract,
  ExecutionDivergence,
} from "./types.js";

export type CheckConsistencyInput = {
  contract: ExecutionContract;
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  factsProduced?: string[];
  recoveryAttempt?: number;
};

/**
 * Verifica consistência plano × execução após cada tool.
 */
export function checkExecutionConsistency(input: CheckConsistencyInput): ExecutionConsistencyResult {
  const divergences: ExecutionDivergence[] = [];
  const effective = input.toolOutcomes.filter((t) => !isSkippedToolOutcome(t.preview));
  const names = effective.map((t) => t.name);
  const pendingTools = pendingRequiredToolNames(input.contract.turnPlan, input.toolOutcomes);

  // Required tools pendentes
  for (const req of pendingTools) {
    divergences.push({
      kind: "missing_required_tool",
      detail: `Ferramenta obrigatória não utilizada: ${req}`,
      severity: "critical",
    });
  }

  // Forbidden pair
  const pair = findForbiddenPairViolation(names, input.contract.forbiddenPairs);
  if (pair) {
    divergences.push({
      kind: "forbidden_tool_used",
      detail: `Par proibido no mesmo turno: ${pair.a} + ${pair.b}`,
      severity: "high",
    });
  }

  // Turn policy violations
  const policyAlerts = validateToolOutcomesAgainstTurnPolicy(
    effective,
    input.contract.turnPlan.turnPolicy,
  );
  for (const alert of policyAlerts) {
    divergences.push({
      kind: "constraint_violation",
      detail: alert,
      severity: "high",
    });
  }

  // Forbidden tools from orchestrator
  for (const name of names) {
    if (input.contract.forbiddenTools.some((f) => f.toLowerCase() === name.toLowerCase())) {
      divergences.push({
        kind: "forbidden_tool_used",
        detail: `Ferramenta proibida neste turno: ${name}`,
        severity: "critical",
      });
    }
  }

  // Facts esperados vs produzidos
  const pendingFacts: string[] = [];
  if (input.contract.eilPlan?.pendingFacts) {
    for (const fact of input.contract.eilPlan.pendingFacts) {
      const produced = input.factsProduced?.includes(fact);
      if (!produced) {
        pendingFacts.push(fact);
        divergences.push({
          kind: "missing_fact",
          detail: `Fact esperado ausente: ${fact}`,
          severity: "medium",
        });
      }
    }
  }

  // Phase mismatch: resposta antes de concluir plano
  if (pendingTools.length > 0 && input.contract.plan.phase === "reply") {
    divergences.push({
      kind: "phase_mismatch",
      detail: "Fase reply antes de concluir tools obrigatórias",
      severity: "critical",
    });
  }

  const critical = divergences.filter((d) => d.severity === "critical");
  const consistent = critical.length === 0;

  // Recovery para primeira tool obrigatória falhada
  let recoverySuggested = null;
  const failedRequired = effective.find(
    (t) =>
      !t.ok &&
      input.contract.requiredTools.some((r) => toolOutcomeSatisfiesRequired(r, [{ name: t.name }])),
  );
  if (failedRequired) {
    recoverySuggested = planToolRecovery({
      contract: input.contract,
      toolName: failedRequired.name,
      ok: false,
      attempt: input.recoveryAttempt ?? 0,
    });
  }

  return {
    consistent,
    divergences,
    pendingTools,
    pendingFacts,
    recoverySuggested,
  };
}
