/**
 * Runtime V2 Bridge — ponto de entrada único para Execution Runtime V2.
 * Compõe contratos, orchestrator, validação e auditoria.
 */

import { buildOrchestratorPromptBlock, buildExecutionContract } from "./ExecutionContractBuilder.js";
import { validateBeforeExecution } from "./PreExecutionValidator.js";
import { orchestrateTools, filterToolsByOrchestrator } from "./ToolOrchestrator.js";
import { checkExecutionConsistency } from "./ExecutionConsistency.js";
import { evaluateSmartFallback } from "./SmartFallback.js";
import { buildExecutionAuditReport } from "./ExecutionAuditReport.js";
import type {
  ExecutionContract,
  RuntimeV2Snapshot,
  ToolOrchestratorDecision,
} from "./types.js";

export type InitializeRuntimeV2Opts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames: string[];
  availableToolCatalog?: import("../validators/requiredToolNamesParser.js").ToolCatalogEntry[];
  lastAssistantMessage?: string;
  flowSlots?: Record<string, unknown>;
  systemPrompt?: string;
  existingTurnPlan?: import("../planner/ExecutionTurnPlan.js").ExecutionTurnPlan;
};

export type RuntimeV2Session = {
  contract: ExecutionContract;
  orchestrator: ToolOrchestratorDecision;
  orchestratorPromptBlock: string;
  preValidation: ReturnType<typeof validateBeforeExecution>;
  startedAt: string;
  recoveries: import("./types.js").ToolRecoveryAction[];
  blocks: string[];
};

/**
 * Inicializa sessão Runtime V2 — chamar antes de qualquer LLM/tool round.
 */
export function initializeRuntimeV2(opts: InitializeRuntimeV2Opts): RuntimeV2Session {
  const preValidation = validateBeforeExecution({
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames,
    availableToolCatalog: opts.availableToolCatalog,
    lastAssistantMessage: opts.lastAssistantMessage,
    flowSlots: opts.flowSlots,
    systemPrompt: opts.systemPrompt,
    existingTurnPlan: opts.existingTurnPlan,
  });

  const contract = preValidation.contract;
  const orchestrator = orchestrateTools({
    contract,
    availableToolNames: opts.availableToolNames,
    toolsAlreadyCalled: [],
  });

  return {
    contract,
    orchestrator,
    orchestratorPromptBlock: buildOrchestratorPromptBlock(orchestrator),
    preValidation,
    startedAt: new Date().toISOString(),
    recoveries: [],
    blocks: [],
  };
}

/** Atualiza orchestrator após cada tool round. */
export function refreshRuntimeV2Orchestrator(
  session: RuntimeV2Session,
  availableToolNames: string[],
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>,
): RuntimeV2Session {
  const orchestrator = orchestrateTools({
    contract: session.contract,
    availableToolNames,
    toolsAlreadyCalled: toolOutcomes.filter((t) => t.ok).map((t) => t.name),
    toolOutcomes,
  });
  return {
    ...session,
    orchestrator,
    orchestratorPromptBlock: buildOrchestratorPromptBlock(orchestrator),
  };
}

/** Verifica se tool pode ser invocada (pre-exec unificado V2). */
export function assertToolAllowedByRuntimeV2(
  session: RuntimeV2Session,
  toolName: string,
  existingToolNames: string[],
): string | null {
  const forbidden = session.orchestrator.forbiddenToolNames.some(
    (f) => f.toLowerCase() === toolName.toLowerCase(),
  );
  if (forbidden) {
    return `Runtime V2: ferramenta ${toolName} proibida neste turno`;
  }
  const allowed = session.orchestrator.allowedToolNames.some(
    (a) =>
      a.toLowerCase() === toolName.toLowerCase() ||
      toolName.toLowerCase().includes(a.toLowerCase()),
  );
  if (session.orchestrator.allowedToolNames.length > 0 && !allowed) {
    return `Runtime V2: ferramenta ${toolName} fora do allowlist (${session.orchestrator.allowedToolNames.slice(0, 6).join(", ")})`;
  }
  if (
    session.orchestrator.mandatoryNextTool &&
    session.orchestrator.pendingRequired.length > 0
  ) {
    const mandatory = session.orchestrator.mandatoryNextTool.toLowerCase();
    const isMandatory =
      toolName.toLowerCase() === mandatory ||
      toolName.toLowerCase().includes(mandatory);
    const mandatoryAlreadyCalled = existingToolNames.some(
      (n) => n.toLowerCase() === mandatory || n.toLowerCase().includes(mandatory),
    );
    if (!isMandatory && !mandatoryAlreadyCalled) {
      return `Runtime V2: invoque primeiro \`${session.orchestrator.mandatoryNextTool}\` antes de ${toolName}`;
    }
  }
  return null;
}

export {
  buildExecutionContract,
  validateBeforeExecution,
  orchestrateTools,
  filterToolsByOrchestrator,
  checkExecutionConsistency,
  evaluateSmartFallback,
  buildExecutionAuditReport,
  buildOrchestratorPromptBlock,
};

export type { RuntimeV2Snapshot, ExecutionContract, ToolOrchestratorDecision };
