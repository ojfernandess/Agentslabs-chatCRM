import type { AgentEngineConfig, AgentSupervisorTrace } from "../types.js";
import {
  validateAgentWorkflow,
  shouldBlockOutboundFromWorkflow,
  type WorkflowAuditReport,
} from "./WorkflowValidator.js";
import type { ToolRoundOutcome } from "../validators/ToolValidator.js";
import {
  resolveRequiredToolNamesFromBehavior,
  resolveRequiredToolNamesForTurn,
} from "../validators/requiredToolNamesParser.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";
import { buildExecutionTurnPlan, type ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { ExecutionContract } from "../core/types.js";
import { parsePromptBlocks, buildAgentPlaybookFromBlocks } from "../../agentPlaybook.js";

export type WorkflowGateInput = {
  engineConfig: AgentEngineConfig;
  behaviorConfig: Record<string, unknown>;
  userMessage: string;
  replyText: string;
  toolOutcomes: ToolRoundOutcome[];
  kbMeta: { hasUsefulExcerpts: boolean; coversQuery: boolean };
  memorySnapshot?: Record<string, unknown>;
  supervisorTrace?: AgentSupervisorTrace;
  retryCount?: number;
  previousReply?: string;
  validationBlockSend?: boolean;
  llmSupervisorApproved?: boolean | null;
  llmSupervisorSummary?: string;
  graphNodeSequence?: string[];
  kbQueryLikely?: boolean;
  availableToolNames?: string[];
  /** Plano de turno pré-calculado (evita re-parse divergente). */
  turnPlan?: ExecutionTurnPlan;
  /** Snapshot EIL para findings F-EIL. */
  eilSnapshot?: import("../eil/types.js").EilSnapshot;
  /** Contrato de execução compilado (Fase 3). */
  executionContract?: ExecutionContract;
};

export type WorkflowGateResult = {
  /**
   * Sempre false — WF é diagnóstico. Mantido por compatibilidade de API;
   * o runtime NÃO deve limpar a reply com base neste flag.
   */
  blockReply: boolean;
  report?: WorkflowAuditReport;
  requiredToolNames: string[];
  turnPolicy: TurnPolicy;
  turnPlan: ExecutionTurnPlan;
  /** Findings falhados para logging / observabilidade. */
  advisoryFailures: number;
};

/** Activa auditoria unificada apenas em modo estrito com supervisor. */
export function shouldRunWorkflowGate(engineConfig: AgentEngineConfig): boolean {
  return engineConfig.strictMode === true && engineConfig.supervisorEnabled === true;
}

function resolveSystemPromptPreview(behaviorConfig: Record<string, unknown>): string | undefined {
  const pb = behaviorConfig.promptBuilder;
  if (!pb || typeof pb !== "object") return undefined;
  const raw = pb as Record<string, unknown>;
  if (raw.useFullPrompt === true && typeof raw.userCore === "string" && raw.userCore.trim()) {
    return raw.userCore.trim();
  }
  const blocks = parsePromptBlocks(raw.blocks);
  const playbook = buildAgentPlaybookFromBlocks(blocks);
  return playbook || undefined;
}

/**
 * Executa Workflow Validator em modo diagnóstico.
 * Nunca bloqueia outbound — o Supervisor é o único decisor final.
 */
export function runWorkflowGate(input: WorkflowGateInput): WorkflowGateResult {
  const turnPlan =
    input.turnPlan ??
    buildExecutionTurnPlan({
      behaviorConfig: input.behaviorConfig,
      userMessage: input.userMessage,
      availableToolNames: input.availableToolNames,
    });
  const { requiredToolNames: planRequired, turnPolicy: planPolicy } = turnPlan;
  const requiredToolNames = input.executionContract?.requiredToolNames ?? planRequired;
  const turnPolicyForValidation = input.executionContract != null ? undefined : planPolicy;

  if (!shouldRunWorkflowGate(input.engineConfig)) {
    return {
      blockReply: false,
      requiredToolNames,
      turnPolicy: planPolicy,
      turnPlan,
      advisoryFailures: 0,
    };
  }

  const report = validateAgentWorkflow({
    userMessage: input.userMessage,
    replyText: input.replyText,
    toolOutcomes: input.toolOutcomes,
    kbMeta: input.kbMeta,
    strictMode: input.engineConfig.strictMode,
    supervisorEnabled: input.engineConfig.supervisorEnabled,
    memorySnapshot: input.memorySnapshot,
    retryCount: input.retryCount,
    previousReply: input.previousReply,
    validationBlockSend: input.validationBlockSend,
    llmApproved: input.llmSupervisorApproved,
    llmSummary: input.llmSupervisorSummary,
    requiredToolNames,
    turnPolicy: turnPolicyForValidation,
    behaviorConfig: input.executionContract != null ? undefined : input.behaviorConfig,
    systemPromptPreview: resolveSystemPromptPreview(input.behaviorConfig),
    graphNodeSequence: input.graphNodeSequence,
    supervisorTrace: input.supervisorTrace,
    eilSnapshot: input.eilSnapshot,
    executionContract: input.executionContract,
  });

  const advisoryFailures = report.findings.filter((f) => !f.passed).length;

  return {
    blockReply: shouldBlockOutboundFromWorkflow(report),
    report,
    requiredToolNames,
    turnPolicy: planPolicy,
    turnPlan,
    advisoryFailures,
  };
}

export type ResolveRequiredToolsForValidationOptions = {
  userMessage?: string;
  availableToolNames?: string[];
};

/**
 * Resolve requiredToolNames para validateToolExecution nos runtimes.
 * Preferir turno actual (mensagem) — genérico para todos os segmentos.
 */
export function resolveRequiredToolNamesForValidation(
  behaviorConfig: Record<string, unknown>,
  options: ResolveRequiredToolsForValidationOptions = {},
): string[] {
  if (options.userMessage?.trim()) {
    return resolveRequiredToolNamesForTurn(behaviorConfig, options);
  }
  return resolveRequiredToolNamesFromBehavior(behaviorConfig);
}
