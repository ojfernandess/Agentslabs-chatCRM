/**
 * Execution Audit Report — relatório automático ao final de cada execução.
 */

import { detectSelfHealingPatterns } from "./SelfHealing.js";
import type {
  ExecutionAuditReport,
  ExecutionConsistencyResult,
  ExecutionContract,
  PreExecutionValidationResult,
  SmartFallbackDecision,
  ToolOrchestratorDecision,
  ToolRecoveryAction,
} from "./types.js";

export type BuildAuditReportInput = {
  contract: ExecutionContract;
  startedAt: string;
  finishedAt: string;
  executedTools: string[];
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  factsProduced: string[];
  divergences: ExecutionConsistencyResult["divergences"];
  recoveries: ToolRecoveryAction[];
  blocks: string[];
  decisions: {
    orchestrator?: ToolOrchestratorDecision;
    preExecution?: PreExecutionValidationResult;
    fallback?: SmartFallbackDecision;
    consistency?: ExecutionConsistencyResult;
  };
  supervisorRetries?: number;
  fallbackUsed?: boolean;
};

function inferRootCause(input: BuildAuditReportInput): string | null {
  const critical = input.divergences.filter((d) => d.severity === "critical");
  if (critical.some((d) => d.kind === "missing_required_tool")) {
    return "Ferramenta obrigatória não executada — LLM escolheu fora do plano ou validação tardia";
  }
  if (critical.some((d) => d.kind === "forbidden_tool_used")) {
    return "Ferramenta proibida executada — allowlist insuficiente ou pre-exec bypass";
  }
  if (input.blocks.length > 0 && input.supervisorRetries && input.supervisorRetries >= 2) {
    return "Supervisor bloqueou após retries — estado inconsistente entre camadas";
  }
  if (input.fallbackUsed && input.contract.plan.phase === "tools") {
    return "Fallback textual com plano de tools incompleto";
  }
  if (input.executedTools.length === 0 && input.contract.requiredTools.length > 0) {
    return "Nenhuma tool executada apesar de obrigatórias no contrato";
  }
  return critical[0]?.detail ?? null;
}

/** Gera relatório de auditoria automática (MCP-explicável). */
export function buildExecutionAuditReport(input: BuildAuditReportInput): ExecutionAuditReport {
  const started = new Date(input.startedAt).getTime();
  const finished = new Date(input.finishedAt).getTime();
  const expectedTools = input.contract.plan.toolSequence;
  const executedSet = new Set(input.executedTools.map((t) => t.toLowerCase()));
  const ignoredTools = expectedTools.filter(
    (t) => !input.executedTools.some((e) => e.toLowerCase().includes(t.toLowerCase())),
  );
  const pendingTools = input.contract.requiredTools.filter(
    (r) =>
      !input.toolOutcomes.some(
        (o) => o.ok && o.name.toLowerCase().includes(r.toLowerCase()),
      ),
  );
  const factsMissing = input.contract.expectedFacts.filter(
    (f) => !input.factsProduced.includes(f),
  );

  const selfHealing = detectSelfHealingPatterns({
    audit: {
      contractId: input.contract.contractId,
      pendingTools,
      executedTools: input.executedTools,
      divergences: input.divergences,
      blocks: input.blocks,
    },
    supervisorRetries: input.supervisorRetries,
    fallbackUsed: input.fallbackUsed,
  });

  return {
    contractId: input.contract.contractId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, finished - started),
    expectedPlan: input.contract.plan,
    executedTools: input.executedTools,
    ignoredTools,
    pendingTools,
    factsProduced: input.factsProduced,
    factsMissing,
    divergences: input.divergences,
    recoveries: input.recoveries,
    blocks: input.blocks,
    selfHealing,
    rootCause: inferRootCause(input),
    decisions: input.decisions,
  };
}
