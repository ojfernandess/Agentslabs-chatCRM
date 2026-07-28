/**
 * Tool Orchestrator — escolhe e ordena ferramentas independentemente do LLM.
 */

import { pendingRequiredToolNames } from "../contract/TurnExecutionContract.js";
import { toolNamesMatch, toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { findForbiddenPairViolation, isEscalationToolName } from "../validators/turnPolicyParser.js";
import type { ExecutionContract, ToolOrchestratorDecision } from "./types.js";

export type OrchestrateToolsOpts = {
  contract: ExecutionContract;
  availableToolNames: string[];
  toolsAlreadyCalled: string[];
  toolOutcomes?: Array<{ name: string; ok: boolean; preview?: string }>;
};

function matchesAvailable(required: string, available: string[]): string | null {
  for (const a of available) {
    if (toolNamesMatch(required, a)) return a;
  }
  return null;
}

function exclusiveAllowsTool(exclusive: string[], toolName: string): boolean {
  return exclusive.some((a) => toolNamesMatch(a, toolName));
}

/** Após cumprir tools obrigatórias do turno, bloqueia novas invocações operacionais no mesmo turno. */
function forbidUnscheduledToolsAfterPlanComplete(
  contract: ExecutionContract,
  availableToolNames: string[],
  outcomes: Array<{ name: string; ok: boolean; preview?: string }>,
  pending: string[],
): string[] {
  if (pending.length > 0) return [];
  const requiredThisTurn = contract.turnPlan.requiredToolNames;
  if (requiredThisTurn.length === 0) return [];

  const satisfiedRequired = requiredThisTurn.every((req) =>
    outcomes.some(
      (t) =>
        t.ok &&
        toolOutcomeSatisfiesRequired(req, [{ name: t.name, preview: t.preview ?? "" }]),
    ),
  );
  if (!satisfiedRequired) return [];

  const forbidden: string[] = [];
  for (const name of availableToolNames) {
    const requiredNow = requiredThisTurn.some((req) => toolNamesMatch(req, name));
    if (requiredNow) continue;
    const alreadyOk = outcomes.some(
      (t) => t.ok && toolNamesMatch(t.name, name),
    );
    if (alreadyOk) continue;
    if (/buscar_conhecimento|knowledge|listar_|atribuir_etiquetas/i.test(name)) continue;
    forbidden.push(name);
  }
  return forbidden;
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
      const ok = exclusiveAllowsTool(exclusive, name);
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

  // Próxima tool obrigatória — procura no catálogo completo (oc_tool_ ↔ canónico)
  let mandatoryNextTool: string | null = null;
  for (const req of pending) {
    const matched =
      matchesAvailable(req, allowedToolNames) ?? matchesAvailable(req, availableToolNames);
    if (matched) {
      mandatoryNextTool = matched;
      if (!allowedToolNames.some((a) => toolNamesMatch(a, matched))) {
        allowedToolNames.push(matched);
      }
      break;
    }
  }

  for (const extra of forbidUnscheduledToolsAfterPlanComplete(
    contract,
    availableToolNames,
    outcomes,
    pending,
  )) {
    if (!forbiddenToolNames.some((f) => toolNamesMatch(f, extra))) {
      forbiddenToolNames.push(extra);
    }
    const idx = allowedToolNames.findIndex((a) => toolNamesMatch(a, extra));
    if (idx >= 0) allowedToolNames.splice(idx, 1);
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

function toolDefinitionMatchesName<T extends { function: { name: string } }>(
  tool: T,
  target: string,
): boolean {
  return toolNamesMatch(target, tool.function.name);
}

/** Filtra definições OpenAI tools pelo orchestrator. */
export function filterToolsByOrchestrator<T extends { function: { name: string } }>(
  tools: T[],
  decision: ToolOrchestratorDecision,
): T[] {
  const allowed = new Set(decision.allowedToolNames.map((n) => n.toLowerCase()));
  const forbiddenLower = new Set(decision.forbiddenToolNames.map((f) => f.toLowerCase()));

  const notForbidden = (t: T) => {
    const fn = t.function.name.toLowerCase();
    if (forbiddenLower.has(fn)) return false;
    return !decision.forbiddenToolNames.some((f) => toolDefinitionMatchesName(t, f));
  };

  if (allowed.size === 0) {
    const targets = [
      ...(decision.mandatoryNextTool ? [decision.mandatoryNextTool] : []),
      ...decision.pendingRequired,
    ];
    if (targets.length > 0) {
      return tools.filter(
        (t) => notForbidden(t) && targets.some((target) => toolDefinitionMatchesName(t, target)),
      );
    }
    if (decision.forbiddenToolNames.length > 0) {
      return tools.filter(notForbidden);
    }
    return tools;
  }

  return tools.filter((t) => {
    if (!notForbidden(t)) return false;
    const fn = t.function.name.toLowerCase();
    for (const a of decision.allowedToolNames) {
      const al = a.toLowerCase();
      if (fn === al || fn.includes(al) || al.includes(fn)) return true;
    }
    return allowed.has(fn);
  });
}
