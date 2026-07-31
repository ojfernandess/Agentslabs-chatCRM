import type { TurnPolicy } from "../validators/turnPolicyParser.js";
import { buildUnifiedExecutionPlan } from "./UnifiedExecutionPlanner.js";
import type { BuildUnifiedExecutionPlanOpts } from "./UnifiedExecutionPlanner.js";

/**
 * Plano de turno — fonte única de verdade para tools obrigatórias e política.
 * Fase 3: delega ao UnifiedExecutionPlanner (Prompt IR → plano).
 */
export type ExecutionTurnPlan = {
  userMessage: string;
  requiredToolNames: string[];
  turnPolicy: TurnPolicy;
  knowledgeSeeking: boolean;
  matchedPatternIds: string[];
};

export type BuildExecutionTurnPlanOpts = BuildUnifiedExecutionPlanOpts;

/** @deprecated Prefer buildUnifiedExecutionPlan — mantido para retrocompat. */
export function buildExecutionTurnPlan(opts: BuildExecutionTurnPlanOpts): ExecutionTurnPlan {
  const unified = buildUnifiedExecutionPlan(opts);
  return {
    userMessage: unified.userMessage,
    requiredToolNames: unified.requiredToolNames,
    turnPolicy: unified.turnPolicy,
    knowledgeSeeking: unified.knowledgeSeeking,
    matchedPatternIds: unified.matchedPatternIds,
  };
}
