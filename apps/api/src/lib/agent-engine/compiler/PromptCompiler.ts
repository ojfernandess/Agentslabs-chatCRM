import { compilePromptToIR } from "./compilePromptToIR.js";
import { promptIrToContract } from "../contract/promptIrAdapter.js";
import type { PromptContract } from "../core/types.js";

export type CompilePromptContractOpts = import("./compilePromptToIR.js").CompilePromptToIROpts;

/**
 * Compila playbook → PromptContract via Prompt IR.
 * API legacy preservada — implementação única em compilePromptToIR.
 */
export function compilePromptContract(opts: CompilePromptContractOpts): PromptContract {
  return promptIrToContract(compilePromptToIR(opts));
}

export { compilePromptToIR, compileStaticPromptIR } from "./compilePromptToIR.js";
export type { CompilePromptToIROpts } from "./compilePromptToIR.js";
