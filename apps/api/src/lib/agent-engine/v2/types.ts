/**
 * Execution Runtime V2 — tipos genéricos de plataforma.
 * O LLM não controla orquestração; o Runtime valida contratos estruturados.
 */

import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { ExecutionIntelligencePlan } from "../eil/types.js";
import type { CapabilityGraph, FactStore } from "../eil/types.js";
import type { TurnPolicy, ForbiddenToolPair } from "../validators/turnPolicyParser.js";

/** Etapa estruturada extraída do playbook (Prompt Compiler). */
export type PromptContractStep = {
  id: string;
  label: string;
  /** Tools mencionadas nesta etapa. */
  tools: string[];
  /** Restrições textuais normalizadas. */
  constraints: string[];
  /** Dependências de outras etapas (ids). */
  dependsOn: string[];
};

/** Contrato compilado do prompt — Supervisor/WF nunca interpretam texto livre. */
export type PromptContract = {
  version: 2;
  compiledAt: string;
  /** Hash estável do playbook fonte. */
  sourceHash: string;
  steps: PromptContractStep[];
  globalRequiredTools: string[];
  globalOptionalTools: string[];
  globalForbiddenPairs: ForbiddenToolPair[];
  restrictions: string[];
  completionCriteria: string[];
  turnPolicyTemplate: TurnPolicy;
  audit: {
    loadedCompletely: boolean;
    restrictionsPresent: boolean;
    issues: string[];
  };
};

/** Intenção detectada (heurística genérica — não domínio). */
export type DetectedIntent = {
  patternIds: string[];
  knowledgeSeeking: boolean;
  isConfirmation: boolean;
  isContinuation: boolean;
  label: string;
};

/** Plano de execução determinístico. */
export type ExecutionPlan = {
  /** Ordem sugerida de tools pendentes. */
  toolSequence: string[];
  /** Tool que o runtime exige invocar a seguir (null = livre dentro do allowlist). */
  mandatoryNextTool: string | null;
  /** Fase do plano: tools | reply | complete */
  phase: "tools" | "reply" | "complete";
  completionCriteriaMet: boolean;
};

/** Execution Contract — nenhuma resposta sem contrato válido. */
export type ExecutionContract = {
  version: 2;
  contractId: string;
  createdAt: string;
  intent: DetectedIntent;
  turnPlan: ExecutionTurnPlan;
  promptContract: PromptContract;
  eilPlan?: ExecutionIntelligencePlan;
  capabilityGraph?: CapabilityGraph;
  facts: FactStore;
  /** Tools que devem ser invocadas neste turno. */
  requiredTools: string[];
  /** Tools permitidas mas não obrigatórias. */
  optionalTools: string[];
  /** Tools bloqueadas neste turno. */
  forbiddenTools: string[];
  /** Pares proibidos no mesmo turno. */
  forbiddenPairs: ForbiddenToolPair[];
  /** Facts que o plano espera produzir. */
  expectedFacts: string[];
  /** Facts já presentes antes da execução. */
  existingFacts: string[];
  /** Constraints EIL + turn policy. */
  constraints: string[];
  /** Capabilities relevantes ao turno. */
  capabilities: string[];
  plan: ExecutionPlan;
  /** Critérios de conclusão (texto estruturado do playbook). */
  completionCriteria: string[];
  valid: boolean;
  validationErrors: string[];
};

/** Decisão do Tool Orchestrator. */
export type ToolOrchestratorDecision = {
  allowedToolNames: string[];
  forbiddenToolNames: string[];
  mandatoryNextTool: string | null;
  reason: string;
  pendingRequired: string[];
};

/** Resultado da validação pré-execução. */
export type PreExecutionValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Correções aplicadas automaticamente. */
  autoFixes: string[];
  contract: ExecutionContract;
};

/** Decisão de fallback inteligente. */
export type SmartFallbackDecision = {
  allowPlainChat: boolean;
  allowReplyGeneration: boolean;
  reason: string;
  /** Retry tool runtime antes de fallback textual. */
  retryToolRuntime: boolean;
  /** Trocar provider/modelo. */
  escalateProvider: boolean;
  operationalError: string | null;
};

/** Acção de recuperação de tool. */
export type ToolRecoveryAction = {
  kind: "local_retry" | "provider_switch" | "model_switch" | "tool_runtime_retry" | "abort";
  toolName: string;
  reason: string;
  attempt: number;
};

/** Divergência plano vs executado. */
export type ExecutionDivergence = {
  kind:
    | "missing_required_tool"
    | "forbidden_tool_used"
    | "missing_fact"
    | "unexpected_fact"
    | "constraint_violation"
    | "phase_mismatch";
  detail: string;
  severity: "low" | "medium" | "high" | "critical";
};

/** Resultado de consistência pós-tool. */
export type ExecutionConsistencyResult = {
  consistent: boolean;
  divergences: ExecutionDivergence[];
  pendingTools: string[];
  pendingFacts: string[];
  recoverySuggested: ToolRecoveryAction | null;
};

/** Padrão auto-detectado (Self Healing). */
export type SelfHealingPattern = {
  id: string;
  label: string;
  detected: boolean;
  mitigation: string;
};

/** Relatório de auditoria automática (fim de execução). */
export type ExecutionAuditReport = {
  contractId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  expectedPlan: ExecutionPlan;
  executedTools: string[];
  ignoredTools: string[];
  pendingTools: string[];
  factsProduced: string[];
  factsMissing: string[];
  divergences: ExecutionDivergence[];
  recoveries: ToolRecoveryAction[];
  blocks: string[];
  selfHealing: SelfHealingPattern[];
  rootCause: string | null;
  /** Snapshot MCP-explicável. */
  decisions: {
    orchestrator?: ToolOrchestratorDecision;
    preExecution?: PreExecutionValidationResult;
    fallback?: SmartFallbackDecision;
    consistency?: ExecutionConsistencyResult;
  };
};

/** Snapshot serializável para trace / MCP. */
export type RuntimeV2Snapshot = {
  contract: ExecutionContract;
  orchestrator?: ToolOrchestratorDecision;
  audit?: ExecutionAuditReport;
};
