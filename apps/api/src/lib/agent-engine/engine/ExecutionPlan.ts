import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { ExecutionIntelligencePlan } from "../eil/types.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";

/**
 * Plano unificado do turno — facade sobre ExecutionTurnPlan + EIL.
 * Uma resolução por turno via ExecutionEngine.beginTurn / refreshTurn.
 */
export type EngineExecutionPlan = {
  turnPlan: ExecutionTurnPlan;
  eilPlan?: ExecutionIntelligencePlan;
  turnPolicy: TurnPolicy;
  requiredToolNames: string[];
};

export function enginePlanFromTurn(
  turnPlan: ExecutionTurnPlan,
  eilPlan?: ExecutionIntelligencePlan,
): EngineExecutionPlan {
  return {
    turnPlan,
    eilPlan,
    turnPolicy: turnPlan.turnPolicy,
    requiredToolNames: turnPlan.requiredToolNames,
  };
}
