import type { AgentSupervisorTrace } from "../types.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import type { ExecutionContract } from "./types.js";

export type TurnContractGateInput = {
  strictMode: boolean;
  validationBlockSend?: boolean;
  supervisorTrace?: AgentSupervisorTrace;
  retryCount: number;
  canRetry: boolean;
  executionContract?: ExecutionContract | null;
  toolOutcomes?: Array<{ name: string; ok?: boolean }>;
  /**
   * Motor Padrão recover-first: não esvazia outbound só por Required pendente
   * após loops de recovery — só bloqueia política proibida / supervisor final.
   */
  recoverFirst?: boolean;
};

/**
 * Gate de outbound baseado no contrato de turno — não interpreta prompt textual.
 * Com recoverFirst, Required pendente não limpa a reply (resilience já tentou).
 */
export function shouldBlockOutboundFromTurnContract(opts: TurnContractGateInput): boolean {
  if (!opts.strictMode) return false;

  if (opts.validationBlockSend === true) return true;

  if (!opts.recoverFirst) {
    if (opts.executionContract && !opts.executionContract.valid) {
      return true;
    }

    if (opts.executionContract?.requiredToolNames.length) {
      const outcomes = opts.toolOutcomes ?? [];
      const missing = opts.executionContract.requiredToolNames.filter(
        (n) => !toolOutcomeSatisfiesRequired(n, outcomes),
      );
      if (missing.length > 0) return true;
    }
  }

  if (!opts.supervisorTrace) return false;
  if (opts.supervisorTrace.approved) return false;
  if (opts.canRetry) return false;

  return true;
}

export function blockReasonFromTurnContract(opts: TurnContractGateInput): string {
  if (opts.validationBlockSend) return "validation_block_send";
  if (opts.executionContract?.violations.length) {
    return opts.executionContract.violations.slice(0, 2).join("; ");
  }
  if (opts.supervisorTrace && !opts.supervisorTrace.approved) {
    return opts.supervisorTrace.summary || "supervisor_rejected";
  }
  return "turn_contract_gate";
}
