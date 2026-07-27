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
import { resolveTurnPolicy, type TurnPolicy } from "../validators/turnPolicyParser.js";
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
};

export type WorkflowGateResult = {
  blockReply: boolean;
  report?: WorkflowAuditReport;
  requiredToolNames: string[];
  turnPolicy: TurnPolicy;
};

/** Activa gate unificado apenas em modo estrito com supervisor (QA Fase 2). */
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

/** Executa Workflow Validator e decide bloqueio de outbound. */
export function runWorkflowGate(input: WorkflowGateInput): WorkflowGateResult {
  const requiredToolNames = resolveRequiredToolNamesForTurn(input.behaviorConfig, {
    userMessage: input.userMessage,
    availableToolNames: input.availableToolNames,
  });
  const turnPolicy = resolveTurnPolicy(input.behaviorConfig, {
    userMessage: input.userMessage,
  });

  if (!shouldRunWorkflowGate(input.engineConfig)) {
    return { blockReply: false, requiredToolNames, turnPolicy };
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
    turnPolicy,
    behaviorConfig: input.behaviorConfig,
    systemPromptPreview: resolveSystemPromptPreview(input.behaviorConfig),
    graphNodeSequence: input.graphNodeSequence,
    supervisorTrace: input.supervisorTrace,
  });

  return {
    blockReply: shouldBlockOutboundFromWorkflow(report),
    report,
    requiredToolNames,
    turnPolicy,
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
