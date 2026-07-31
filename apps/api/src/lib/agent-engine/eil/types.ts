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
  /** Tools incompatíveis no mesmo turno (além do playbook). */
  conflictsWith?: string[];
  /** Timeout sugerido (ms) — metadata; runtime HTTP pode honrar depois. */
  timeoutMs?: number;
  /** Retries sugeridos em falha transitória. */
  retryMax?: number;
  /** Provider / integração (ex. audaar, http, native). */
  provider?: string;
  /** Versão semântica da tool. */
  version?: string;
  /** Nome estável para resolver oc_tool_<uuid> → audaar_* (P-011). */
  stableName?: string;
  /** Valores por defeito injectados nos args do scheduler. */
  argDefaults?: Record<string, unknown>;
  /** target arg → lista de chaves de facts/args a copiar (primeiro não-vazio ganha). */
  argAliases?: Record<string, string[]>;
  /** Agrupa facts flat num objecto nested (ex. mainGuest). */
  nestedGroups?: Array<{
    target: string;
    fieldMap: Record<string, string[]>;
  }>;
  /** entity do IntentAnalyzer → nomes de args a preencher. */
  entityArgMap?: Record<string, string[]>;
  /** Arg que recebe a user message inteira (ex. query em buscar_conhecimento). */
  messageArg?: string;
};

export type CapabilityNode = {
  toolName: string;
  capabilities: string[];
  produces: string[];
  requiresFacts: string[];
  factPaths: Record<string, string>;
  conflictsWith: string[];
  timeoutMs?: number;
  retryMax?: number;
  provider?: string;
  version?: string;
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
  | "complete_flow"
  | "assert_operational_data";

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
  /** Alinhado com ExecutionEngine / buildExecutionTurnPlan — evita plano EIL stale. */
  priorToolOutcomes?: Array<{ name: string; ok?: boolean }>;
  sessionPriorOutcomes?: Array<{ name: string; ok?: boolean }>;
  lastAssistantMessage?: string | null;
  memory?: Record<string, unknown> | null;
  freezeCompletionPromotion?: boolean;
  postCompletionFollowUp?: boolean;
  workflowPlannedToolNames?: string[];
};
