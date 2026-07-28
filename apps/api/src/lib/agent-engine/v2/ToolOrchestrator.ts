/**
 * Tool Orchestrator — escolhe e ordena ferramentas independentemente do LLM.
 */

import { pendingRequiredToolNames } from "../contract/TurnExecutionContract.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { findForbiddenPairViolation, isEscalationToolName } from "../validators/turnPolicyParser.js";
import type { ExecutionContract, ToolOrchestratorDecision } from "./types.js";

export type OrchestrateToolsOpts = {
  contract: ExecutionContract;
  availableToolNames: string[];
  toolsAlreadyCalled: string[];
  toolOutcomes?: Array<{ name: string; ok: boolean; preview?: string }>;
};

function matchesAvailable(required: string, available: string[]): string | null {
  const req = required.toLowerCase().replace(/-/g, "_");
  for (const a of available) {
    const al = a.toLowerCase().replace(/-/g, "_");
    if (al === req || al.includes(req) || req.includes(al)) return a;
  }
  return null;
}

/**
 * Decide quais tools o LLM pode ver e qual deve invocar a seguir.
 * O LLM não escolhe livremente — recebe allowlist + mandatoryNextTool.
 */
export function orchestrateTools(opts: OrchestrateToolsOpts): ToolOrchestratorDecision {
  const { contract, availableToolNames, toolsAlreadyCalled } = opts;
  const outcomes = opts.toolOutcomes ?? toolsAlreadyCalled.map((n) => ({ name: n, ok: true }));
  const pending = pendingRequiredToolNames(contract.turnPlan, outcomes);

  const forbiddenSet = new Set(contract.forbiddenTools.map((t) => t.toLowerCase()));
  const allowedToolNames: string[] = [];
  const forbiddenToolNames: string[] = [];

  for (const name of availableToolNames) {
    if (forbiddenSet.has(name.toLowerCase())) {
      forbiddenToolNames.push(name);
      continue;
    }
    // Turno exclusivo: só allowlist
    const exclusive = contract.turnPlan.turnPolicy.exclusiveAllowedTools;
    if (exclusive?.length) {
      const ok = exclusive.some((a) =>
        toolOutcomeSatisfiesRequired(a, [{ name, preview: "" }]),
      );
      if (!ok && !contract.plan.completionCriteriaMet) {
        // Após conclusão, delivery tools podem ser permitidas
        const completionOk = outcomes.some(
          (t) => t.ok && /check|submit|finalize|concluir|book|reservar/i.test(t.name),
        );
        if (!completionOk || !/buscar_conhecimento|knowledge|consultar_|lookup/i.test(name)) {
          forbiddenToolNames.push(name);
          continue;
        }
      }
    }
    if (contract.turnPlan.turnPolicy.blockEscalation && isEscalationToolName(name)) {
      forbiddenToolNames.push(name);
      continue;
    }
    allowedToolNames.push(name);
  }

  // Próxima tool obrigatória (primeira pendente com match disponível)
  let mandatoryNextTool: string | null = null;
  for (const req of pending) {
    const matched = matchesAvailable(req, allowedToolNames);
    if (matched) {
      mandatoryNextTool = matched;
      break;
    }
  }

  // Sequência EIL/capability: tools que produzem facts pendentes
  if (!mandatoryNextTool && contract.eilPlan?.pendingFacts?.length && contract.capabilityGraph) {
    for (const fact of contract.eilPlan.pendingFacts) {
      const producers = contract.capabilityGraph.producersByFact[fact] ?? [];
      for (const prod of producers) {
        const matched = matchesAvailable(prod, allowedToolNames);
        if (matched && !toolsAlreadyCalled.some((t) => t.toLowerCase() === matched.toLowerCase())) {
          mandatoryNextTool = matched;
          break;
        }
      }
      if (mandatoryNextTool) break;
    }
  }

  const pairViolation = findForbiddenPairViolation(
    toolsAlreadyCalled,
    contract.forbiddenPairs,
  );
  const reason = mandatoryNextTool
    ? `Próxima tool obrigatória: ${mandatoryNextTool}`
    : pending.length > 0
      ? `Pendentes: ${pending.join(", ")}`
      : pairViolation
        ? `Par proibido detectado: ${pairViolation.a}+${pairViolation.b}`
        : "Plano de tools concluído — fase reply";

  return {
    allowedToolNames,
    forbiddenToolNames,
    mandatoryNextTool,
    reason,
    pendingRequired: pending,
  };
}

/** Filtra definições OpenAI tools pelo orchestrator. */
export function filterToolsByOrchestrator<T extends { function: { name: string } }>(
  tools: T[],
  decision: ToolOrchestratorDecision,
): T[] {
  const allowed = new Set(decision.allowedToolNames.map((n) => n.toLowerCase()));
  if (allowed.size === 0) return tools;
  return tools.filter((t) => {
    const fn = t.function.name.toLowerCase();
    if (decision.forbiddenToolNames.some((f) => f.toLowerCase() === fn)) return false;
    // Match parcial para oc_tool_ vs canonical names
    for (const a of decision.allowedToolNames) {
      const al = a.toLowerCase();
      if (fn === al || fn.includes(al) || al.includes(fn)) return true;
    }
    // Native tools sempre pelo nome exacto
    return allowed.has(fn);
  });
}
