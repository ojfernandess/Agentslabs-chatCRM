/**
 * Tipos centrais do Runtime OpenNexo — segment-agnostic.
 * TurnContext é a fonte única de verdade por turno.
 */

import type { ExecutionIntelligencePlan, EilSnapshot, FactStore, CapabilityGraph } from "../eil/types.js";
import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";

/** Intenção inferida — nunca escolhe tools nem políticas. */
export type IntentKind =
  | "knowledge_query"
  | "confirmation"
  | "data_submission"
  | "escalation_request"
  | "operational_action"
  | "general";

export type IntentAnalysis = {
  kind: IntentKind;
  confidence: number;
  entities: Record<string, string>;
  expectedGoal: string;
};

/** Contrato compilado a partir do playbook — imutável durante o turno. */
export type PromptContract = {
  version: 1;
  compiledAt: string;
  promptHash: string;
  objective: string;
  requiredToolNames: string[];
  optionalToolNames: string[];
  forbiddenToolNames: string[];
  forbiddenSameTurnPairs: Array<{ a: string; b: string }>;
  preconditions: string[];
  postconditions: string[];
  restrictions: string[];
  turnPolicy: TurnPolicy;
};

/** Contrato de execução — o Runtime trabalha sobre isto. */
export type ExecutionContract = {
  version: 1;
  turnId: string;
  userMessage: string;
  objective: string;
  planPhase: "planning" | "tooling" | "reply" | "complete";
  requiredToolNames: string[];
  forbiddenToolNames: string[];
  pendingToolNames: string[];
  satisfiedToolNames: string[];
  requiredFacts: string[];
  existingFacts: string[];
  constraints: string[];
  completionCriteria: string[];
  valid: boolean;
  violations: string[];
};

/** Contexto completo de um turno. */
export type TurnContext = {
  version: 1;
  userMessage: string;
  intent: IntentAnalysis;
  promptContract: PromptContract;
  turnPlan: ExecutionTurnPlan;
  executionContract: ExecutionContract;
  eilEnabled: boolean;
  eilPlan?: ExecutionIntelligencePlan;
  facts: FactStore;
  capabilityGraph?: CapabilityGraph;
  eilSnapshot?: EilSnapshot;
  availableToolNames: string[];
};
