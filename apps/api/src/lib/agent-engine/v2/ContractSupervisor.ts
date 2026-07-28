/**
 * Contract Supervisor — valida execução contra Execution Contract (sem interpretar texto livre).
 */

import { pendingRequiredToolNames } from "../contract/TurnExecutionContract.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import {
  findForbiddenPairViolation,
  isSkippedToolOutcome,
} from "../validators/turnPolicyParser.js";
import type { AgentSupervisorCheck } from "../types.js";
import type { ExecutionContract } from "./types.js";

export type ContractSupervisorInput = {
  contract: ExecutionContract;
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  replyText: string;
  validationBlockSend?: boolean;
  consistencyDivergences?: Array<{ kind: string; detail: string; severity: string }>;
};

/** Checks estruturais derivados do Execution Contract — genéricos, sem domínio. */
export function buildContractSupervisorChecks(input: ContractSupervisorInput): AgentSupervisorCheck[] {
  const checks: AgentSupervisorCheck[] = [];
  const effective = input.toolOutcomes.filter((t) => !isSkippedToolOutcome(t.preview));
  const names = effective.map((t) => t.name);
  const pending = pendingRequiredToolNames(input.contract.turnPlan, input.toolOutcomes);

  checks.push({
    id: "contract_valid",
    label: "Execution Contract válido",
    passed: input.contract.valid,
    detail: input.contract.validationErrors.join("; ") || undefined,
  });

  checks.push({
    id: "contract_required_tools",
    label: "Tools obrigatórias do contrato satisfeitas",
    passed: pending.length === 0,
    detail: pending.length > 0 ? `Pendentes: ${pending.join(", ")}` : undefined,
  });

  checks.push({
    id: "contract_phase",
    label: "Fase do plano coerente",
    passed:
      input.contract.plan.phase !== "reply" ||
      pending.length === 0 ||
      input.replyText.trim().length > 0,
    detail:
      input.contract.plan.phase === "tools" && pending.length > 0 && input.replyText.trim()
        ? "Reply gerada antes de concluir fase tools"
        : undefined,
  });

  const pair = findForbiddenPairViolation(names, input.contract.forbiddenPairs);
  checks.push({
    id: "contract_forbidden_pairs",
    label: "Sem pares proibidos no contrato",
    passed: !pair,
    detail: pair ? `${pair.a} + ${pair.b}` : undefined,
  });

  const forbiddenUsed = names.filter((n) =>
    input.contract.forbiddenTools.some((f) => f.toLowerCase() === n.toLowerCase()),
  );
  checks.push({
    id: "contract_forbidden_tools",
    label: "Sem tools proibidas pelo contrato",
    passed: forbiddenUsed.length === 0,
    detail: forbiddenUsed.length > 0 ? forbiddenUsed.join(", ") : undefined,
  });

  for (const req of input.contract.requiredTools) {
    const satisfied = effective.some(
      (t) => t.ok && toolOutcomeSatisfiesRequired(req, [{ name: t.name, preview: t.preview ?? "" }]),
    );
    if (!satisfied && effective.length > 0) {
      // Só falha se turno avançou sem satisfazer (evita false positive no início)
      const stillPending = pending.includes(req);
      if (stillPending) {
        checks.push({
          id: `contract_req_${req}`,
          label: `Contrato: ${req}`,
          passed: false,
          detail: "Não satisfeita neste turno",
        });
      }
    }
  }

  if (input.consistencyDivergences?.length) {
    const critical = input.consistencyDivergences.filter((d) => d.severity === "critical");
    checks.push({
      id: "contract_consistency",
      label: "Consistência plano × execução",
      passed: critical.length === 0,
      detail: critical.map((d) => d.detail).join("; ") || undefined,
    });
  }

  checks.push({
    id: "contract_validation_passed",
    label: "Validação estrutural (contrato)",
    passed: !input.validationBlockSend,
  });

  return checks;
}

/** Merge contract checks into supervisor trace — contract checks têm prioridade. */
export function mergeContractChecks(
  structural: AgentSupervisorCheck[],
  contract: AgentSupervisorCheck[],
): AgentSupervisorCheck[] {
  const contractIds = new Set(contract.map((c) => c.id));
  const filtered = structural.filter(
    (c) =>
      !contractIds.has(c.id) &&
      // Substituir checks legacy por equivalentes de contrato
      c.id !== "validation_passed" &&
      c.id !== "eil_plan_followed",
  );
  return [...contract, ...filtered];
}
