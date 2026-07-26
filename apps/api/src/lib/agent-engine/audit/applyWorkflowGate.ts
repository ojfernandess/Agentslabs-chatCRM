import type { AgentEngineConfig, AgentSupervisorTrace } from "../types.js";
import {
  validateAgentWorkflow,
  shouldBlockOutboundFromWorkflow,
  type WorkflowAuditReport,
} from "./WorkflowValidator.js";
import type { ToolRoundOutcome } from "../validators/ToolValidator.js";
import { resolveRequiredToolNamesFromBehavior } from "../validators/requiredToolNamesParser.js";
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
};

export type WorkflowGateResult = {
  blockReply: boolean;
  report?: WorkflowAuditReport;
  requiredToolNames: string[];
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
  const requiredToolNames = resolveRequiredToolNamesFromBehavior(input.behaviorConfig);

  if (!shouldRunWorkflowGate(input.engineConfig)) {
    return { blockReply: false, requiredToolNames };
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
    systemPromptPreview: resolveSystemPromptPreview(input.behaviorConfig),
    graphNodeSequence: input.graphNodeSequence,
    supervisorTrace: input.supervisorTrace,
  });

  return {
    blockReply: shouldBlockOutboundFromWorkflow(report),
    report,
    requiredToolNames,
  };
}

/** Resolve requiredToolNames para validateToolExecution nos runtimes. */
export function resolveRequiredToolNamesForValidation(
  behaviorConfig: Record<string, unknown>,
): string[] {
  return resolveRequiredToolNamesFromBehavior(behaviorConfig);
}
