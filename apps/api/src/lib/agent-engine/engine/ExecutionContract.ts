import type { ExecutionContract as CoreExecutionContract } from "../core/types.js";

/** Alias tipado — contrato de execução partilhado pela Engine. */
export type EngineExecutionContract = CoreExecutionContract;

export function summarizeEngineContract(contract: EngineExecutionContract): {
  valid: boolean;
  pending: string[];
  satisfied: string[];
  required: string[];
  violations: string[];
} {
  return {
    valid: contract.valid,
    pending: contract.pendingToolNames,
    satisfied: contract.satisfiedToolNames,
    required: contract.requiredToolNames,
    violations: contract.violations,
  };
}
