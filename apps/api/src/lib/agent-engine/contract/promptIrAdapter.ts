import type { PromptContract } from "../core/types.js";
import type { PromptIR } from "./PromptIR.js";

/** Converte PromptIR → PromptContract (compatibilidade com runtime existente). */
export function promptIrToContract(ir: PromptIR): PromptContract {
  return {
    version: 1,
    compiledAt: ir.metadata.compiledAt,
    promptHash: ir.metadata.hash,
    objective: ir.objective,
    requiredToolNames: [...ir.tools.required],
    optionalToolNames: [...ir.tools.optional],
    forbiddenToolNames: [...ir.tools.forbidden],
    forbiddenSameTurnPairs: ir.forbiddenSameTurnPairs.map((p) => ({ a: p.a, b: p.b })),
    preconditions: [...ir.preconditions],
    postconditions: [...ir.postconditions],
    restrictions: [...ir.restrictions],
    turnPolicy: ir.turnPolicy,
  };
}

/** Verifica equivalência contract ↔ IR para regressão. */
export function promptContractMatchesIr(contract: PromptContract, ir: PromptIR): boolean {
  const fromIr = promptIrToContract(ir);
  return (
    contract.promptHash === fromIr.promptHash &&
    contract.objective === fromIr.objective &&
    JSON.stringify(contract.requiredToolNames) === JSON.stringify(fromIr.requiredToolNames) &&
    JSON.stringify(contract.forbiddenSameTurnPairs) === JSON.stringify(fromIr.forbiddenSameTurnPairs)
  );
}
