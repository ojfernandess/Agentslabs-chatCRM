import type { ExecutionContract } from "./types.js";

/** Resumo estruturado do contrato para supervisor LLM — sem markdown do playbook. */
export function formatExecutionContractForSupervisor(contract: ExecutionContract): string {
  const lines: string[] = [
    `Objectivo do turno: ${contract.objective.slice(0, 240)}`,
    `Fase: ${contract.planPhase}`,
  ];
  if (contract.requiredToolNames.length > 0) {
    lines.push(`Tools obrigatórias: ${contract.requiredToolNames.join(", ")}`);
  }
  if (contract.pendingToolNames.length > 0) {
    lines.push(`Tools ainda pendentes: ${contract.pendingToolNames.join(", ")}`);
  }
  if (contract.satisfiedToolNames.length > 0) {
    lines.push(`Tools satisfeitas: ${contract.satisfiedToolNames.join(", ")}`);
  }
  if (contract.forbiddenToolNames.length > 0) {
    lines.push(`Tools proibidas neste turno: ${contract.forbiddenToolNames.join(", ")}`);
  }
  if (contract.constraints.length > 0) {
    lines.push(`Constraints: ${contract.constraints.slice(0, 4).join("; ")}`);
  }
  if (contract.violations.length > 0) {
    lines.push(`Violações activas: ${contract.violations.slice(0, 6).join("; ")}`);
  }
  return lines.join("\n");
}

/** Alertas legíveis derivados do contrato (F3 / supervisor). */
export function executionContractViolationAlerts(contract: ExecutionContract): string[] {
  const alerts: string[] = [];
  for (const v of contract.violations) {
    if (v.startsWith("required_tool_missing:")) {
      alerts.push(`Ferramenta obrigatória em falta: ${v.slice("required_tool_missing:".length)}`);
    } else if (v.startsWith("forbidden_tool_used:")) {
      alerts.push(`Ferramenta proibida invocada: ${v.slice("forbidden_tool_used:".length)}`);
    } else {
      alerts.push(v);
    }
  }
  return alerts;
}

export function executionContractRequiresBlock(contract: ExecutionContract): boolean {
  return !contract.valid || contract.pendingToolNames.length > 0;
}
