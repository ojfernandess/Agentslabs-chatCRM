/**
 * Pre-Execution Validation — valida contratos antes da primeira chamada ao modelo.
 */

import { buildExecutionContract, type BuildExecutionContractOpts } from "./ExecutionContractBuilder.js";
import type { ExecutionContract, PreExecutionValidationResult } from "./types.js";

export type ValidateBeforeExecutionOpts = BuildExecutionContractOpts & {
  contract?: ExecutionContract;
};

/**
 * Valida Prompt Contract + Execution Contract + Capability Graph + Facts.
 * Corrige inconsistências menores antes da execução.
 */
export function validateBeforeExecution(
  opts: ValidateBeforeExecutionOpts,
): PreExecutionValidationResult {
  const autoFixes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let contract = opts.contract ?? buildExecutionContract(opts);

  // Auto-fix: dedupe required tools
  const dedupedRequired = [...new Set(contract.requiredTools)];
  if (dedupedRequired.length !== contract.requiredTools.length) {
    autoFixes.push("Required tools deduplicadas");
    contract = { ...contract, requiredTools: dedupedRequired };
  }

  // Auto-fix: filtrar required tools não disponíveis quando há alias
  if (opts.availableToolNames?.length) {
    const filtered = contract.requiredTools.filter((req) =>
      opts.availableToolNames!.some(
        (a) =>
          a.toLowerCase() === req.toLowerCase() ||
          a.toLowerCase().includes(req.toLowerCase().replace(/-/g, "_")) ||
          req.toLowerCase().includes(a.toLowerCase()),
      ),
    );
    if (filtered.length < contract.requiredTools.length) {
      const dropped = contract.requiredTools.filter((r) => !filtered.includes(r));
      warnings.push(`Required tools sem match directo (alias esperado): ${dropped.join(", ")}`);
    }
  }

  // Prompt contract audit
  if (!contract.promptContract.audit.loadedCompletely) {
    warnings.push("Prompt contract: carregamento parcial do playbook");
  }
  if (!contract.promptContract.audit.restrictionsPresent) {
    warnings.push("Prompt contract: secção de restrições ausente");
  }
  for (const issue of contract.promptContract.audit.issues) {
    warnings.push(`Prompt audit: ${issue}`);
  }

  // Execution contract validation
  errors.push(...contract.validationErrors);

  // EIL constraints
  if (contract.eilPlan?.forbiddenActions?.length) {
    for (const action of contract.eilPlan.forbiddenActions) {
      warnings.push(`EIL forbidden action: ${action}`);
    }
  }

  // Capability graph coherence
  if (contract.capabilityGraph && contract.requiredTools.length > 0) {
    for (const req of contract.requiredTools) {
      const node = contract.capabilityGraph.nodes.find(
        (n) => n.toolName.toLowerCase() === req.toLowerCase(),
      );
      if (!node && contract.capabilityGraph.nodes.length > 0) {
        const partial = contract.capabilityGraph.nodes.find((n) =>
          n.toolName.toLowerCase().includes(req.toLowerCase()),
        );
        if (!partial) {
          warnings.push(`Capability graph: tool ${req} sem nó registado`);
        }
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    autoFixes,
    contract: { ...contract, valid, validationErrors: errors },
  };
}

/** Bloqueia geração de resposta se contrato inválido e erros críticos. */
export function shouldBlockGeneration(result: PreExecutionValidationResult): boolean {
  return !result.valid && result.errors.some((e) => /nenhuma tool disponível/i.test(e));
}
