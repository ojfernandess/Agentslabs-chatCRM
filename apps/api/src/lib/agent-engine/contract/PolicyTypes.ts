/**
 * Políticas e restrições extraídas do playbook — avaliadas pelo Policy Engine.
 */

export type PolicyRuleKind =
  | "forbidden_same_turn_pair"
  | "exclusive_on_confirmation"
  | "block_escalation_on_confirmation"
  | "omit_tool_when_slots_present"
  | "confirmation_prerequisite";

export type PolicyRule = {
  id: string;
  kind: PolicyRuleKind;
  tools?: string[];
  pair?: { a: string; b: string };
  slotKeys?: string[];
  description?: string;
};

export type ConstraintRule = {
  id: string;
  text: string;
};
