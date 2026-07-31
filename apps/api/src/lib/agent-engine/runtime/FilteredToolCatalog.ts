/**
 * Fase 6 — Filtra catálogo de tools para o passo actual do plano.
 */
import type { TurnContext } from "../core/types.js";
import { resolveActiveFlowStep } from "../planner/PlanGraphBuilder.js";

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function filterToolsForCurrentStep(
  allToolNames: string[],
  turnContext: TurnContext,
): string[] {
  const available = new Set(allToolNames.map(normalize));
  const allowed = new Set<string>();

  for (const name of turnContext.executionContract.pendingToolNames) {
    if (available.has(normalize(name))) allowed.add(name);
  }

  const exclusive = turnContext.promptContract.turnPolicy.exclusiveAllowedTools;
  if (exclusive?.length) {
    for (const name of exclusive) {
      if (available.has(normalize(name))) allowed.add(name);
    }
  }

  const flowStep = resolveActiveFlowStep(
    turnContext.promptIr.flows,
    turnContext.executionContract.satisfiedToolNames,
  );
  if (flowStep?.toolNames?.length) {
    for (const name of flowStep.toolNames) {
      if (available.has(normalize(name))) allowed.add(name);
    }
  }

  if (allowed.size === 0) return [...allToolNames];
  return allToolNames.filter((n) => allowed.has(normalize(n)));
}
