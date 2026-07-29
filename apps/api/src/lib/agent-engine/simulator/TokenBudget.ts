/**
 * Token budget — estimativas e pressão de orçamento no prompt do turno.
 */

export type TokenBudgetReport = {
  estimatedPromptTokens: number;
  memoryTokens: number;
  memoryBudget?: number;
  userMessageTokens: number;
  toolOverheadTokens: number;
  /** 0..1+ — >1 significa over budget. */
  memoryPressure: number;
  overMemoryBudget: boolean;
};

export function estimateCharsAsTokens(chars: number): number {
  return Math.max(0, Math.ceil(Math.max(0, chars) / 4));
}

export function estimatePromptTokenBudget(input: {
  systemPromptChars?: number;
  userMessage: string;
  memoryTokens?: number;
  memoryBudget?: number;
  pendingTools?: number;
}): TokenBudgetReport {
  const userMessageTokens = estimateCharsAsTokens(input.userMessage.length);
  const systemTokens = estimateCharsAsTokens(input.systemPromptChars ?? 0);
  const memoryTokens = input.memoryTokens ?? 0;
  const toolOverheadTokens = Math.max(0, input.pendingTools ?? 0) * 40;
  const estimatedPromptTokens =
    systemTokens + userMessageTokens + memoryTokens + toolOverheadTokens + 80;
  const memoryBudget = input.memoryBudget;
  const memoryPressure =
    memoryBudget && memoryBudget > 0 ? memoryTokens / memoryBudget : 0;
  return {
    estimatedPromptTokens,
    memoryTokens,
    memoryBudget,
    userMessageTokens,
    toolOverheadTokens,
    memoryPressure,
    overMemoryBudget: memoryBudget != null && memoryTokens > memoryBudget,
  };
}
