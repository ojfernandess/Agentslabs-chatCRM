/**
 * Execution Intelligence Layer (EIL) — tipos genéricos de plataforma.
 * Zero condicionais de domínio: facts/capabilities/policies são dados.
 */

import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";

/** Valor de um facto estruturado produzido por tool ou memória. */
export type FactValue = string | number | boolean | null;

export type Fact = {
  key: string;
  value: FactValue;
  /** Tool / fonte que produziu o facto. */
  source?: string;
  updatedAt?: string;
};

export type FactStore = Record<string, Fact>;

/** Metadados EIL em `AutomationCustomTool.config.eil`. */
export type ToolEilConfig = {
  produces?: string[];
  requiresFacts?: string[];
  capabilities?: string[];
  /** JSONPath-lite: chave do facto → caminho no payload (ex. "stay.guestsQuantity"). */
  factPaths?: Record<string, string>;
};

export type CapabilityNode = {
  toolName: string;
  capabilities: string[];
  produces: string[];
  requiresFacts: string[];
  factPaths: Record<string, string>;
};

export type CapabilityGraph = {
  nodes: CapabilityNode[];
  /** fact key → tools that produce it */
  producersByFact: Record<string, string[]>;
  /** capability id → tools */
  toolsByCapability: Record<string, string[]>;
};

export type FactPredicateOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists" | "not_exists";

export type FactPredicate = {
  fact: string;
  op: FactPredicateOp;
  value?: FactValue;
};

/** Constraint / policy declarativa (behaviorConfig.eil.policies). */
export type EilPolicy = {
  id: string;
  /** Acção genérica detectada no reply (ex. request_additional_party). */
  action?: string;
  requires?: FactPredicate[];
  forbids?: FactPredicate[];
  /** Se true, a acção fica proibida quando requires falham. */
  blockWhenUnmet?: boolean;
};

export type EilBehaviorConfig = {
  enabled?: boolean;
  policies?: EilPolicy[];
};

export type ConstraintViolation = {
  policyId: string;
  action?: string;
  reason: string;
  predicates: FactPredicate[];
};

/** Acções genéricas detectadas no texto da resposta (sem domínio). */
export type ReplyActionId =
  | "request_additional_party"
  | "confirm"
  | "escalate_human"
  | "ask_document"
  | "ask_payment"
  | "complete_flow";

export type ExecutionIntelligencePlan = ExecutionTurnPlan & {
  requiredFacts: string[];
  knownFactKeys: string[];
  pendingFacts: string[];
  pendingTools: string[];
  pendingCapabilities: string[];
  forbiddenActions: string[];
  policyIds: string[];
  eilEnabled: boolean;
};

export type EilSnapshot = {
  enabled: boolean;
  plan?: ExecutionIntelligencePlan;
  facts: Record<string, FactValue>;
  factDetails: FactStore;
  capabilitiesUsed: string[];
  policiesApplied: string[];
  violations: ConstraintViolation[];
  toolsCalled: string[];
  toolsPending: string[];
  replyActions: ReplyActionId[];
};

export type ToolOutcomeForEil = {
  name: string;
  ok: boolean;
  preview?: string;
  /** Payload JSON parseado (quando disponível). */
  structuredPayload?: unknown;
};

export type BuildEilContextOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
  toolConfigs?: Array<{ name: string; config?: unknown }>;
  priorFacts?: FactStore;
  flowSlots?: Record<string, string | number | boolean>;
  turnPolicy?: TurnPolicy;
};
