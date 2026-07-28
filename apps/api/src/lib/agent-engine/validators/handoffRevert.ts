import {
  isEscalationToolName,
  validateToolOutcomesAgainstTurnPolicy,
  type TurnPolicy,
} from "./turnPolicyParser.js";

export type ToolOutcomeLike = { name: string; ok?: boolean; preview?: string };

/** Escalonamento executou com sucesso mas a política de turno reprovou. */
export function shouldRevertHandoffAfterValidation(
  toolOutcomes: ToolOutcomeLike[],
  validationAlerts: string[],
  turnPolicy?: TurnPolicy | null,
): boolean {
  const escalationRan = toolOutcomes.some((t) => t.ok !== false && isEscalationToolName(t.name));
  if (!escalationRan) return false;

  const policyAlerts = turnPolicy
    ? validateToolOutcomesAgainstTurnPolicy(toolOutcomes, turnPolicy)
    : [];
  const validatorAlerts = validationAlerts.length > 0 ? validationAlerts : policyAlerts;

  if (validatorAlerts.some((a) => /fora da categoria|escalonamento|proibid/i.test(a))) {
    return true;
  }
  return policyAlerts.length > 0;
}
