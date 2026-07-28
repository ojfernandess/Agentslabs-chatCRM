/**
 * Workflow Contract Validator — Fase V2 do Workflow Validator.
 * Valida execução contra Execution Contract (sem interpretação textual legacy).
 */

import { buildContractSupervisorChecks } from "../v2/ContractSupervisor.js";
import type { ExecutionContract } from "../v2/types.js";
import type { ToolRoundOutcome } from "../validators/ToolValidator.js";
import type { WorkflowAuditFinding, WorkflowAuditSeverity } from "./WorkflowValidator.js";

function finding(
  phase: string,
  id: string,
  severity: WorkflowAuditSeverity,
  passed: boolean,
  description: string,
): WorkflowAuditFinding {
  return { phase, id, severity, passed, description };
}

export type WorkflowContractValidationInput = {
  executionContract?: ExecutionContract | null;
  toolOutcomes: ToolRoundOutcome[];
  replyText: string;
  validationBlockSend?: boolean;
  consistencyDivergences?: Array<{ kind: string; detail: string; severity: string }>;
};

/**
 * Findings F-V2 derivados do Execution Contract — substituem checks textuais equivalentes.
 */
export function buildContractWorkflowFindings(
  input: WorkflowContractValidationInput,
): WorkflowAuditFinding[] {
  if (!input.executionContract) {
    return [
      finding("F-V2", "contract_absent", "info", true, "Execution Contract ausente — skip F-V2"),
    ];
  }

  const checks = buildContractSupervisorChecks({
    contract: input.executionContract,
    toolOutcomes: input.toolOutcomes,
    replyText: input.replyText,
    validationBlockSend: input.validationBlockSend,
    consistencyDivergences: input.consistencyDivergences,
  });

  const severityByCheck: Record<string, WorkflowAuditSeverity> = {
    contract_valid: "critical",
    contract_required_tools: "critical",
    contract_phase: "high",
    contract_forbidden_pairs: "high",
    contract_forbidden_tools: "critical",
    contract_consistency: "high",
    contract_validation_passed: "critical",
  };

  return checks.map((c) =>
    finding(
      "F-V2",
      c.id,
      severityByCheck[c.id] ?? (c.id.startsWith("contract_req_") ? "high" : "medium"),
      c.passed,
      c.detail ? `${c.label}: ${c.detail}` : c.label,
    ),
  );
}
