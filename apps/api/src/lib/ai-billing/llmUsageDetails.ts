import type { PreviewLlmUsage } from "../promptModulePreviewLlm.js";

export type LlmUsageDetails = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requestId?: string | null;
  actualModel?: string | null;
};

export function emptyLlmUsageDetails(): LlmUsageDetails {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function mapPreviewUsageToDetails(
  usage: PreviewLlmUsage | undefined | null,
  fallbackModel?: string | null,
): LlmUsageDetails | null {
  if (!usage) return null;
  const cached = usage.cachedInput ?? 0;
  const inputTokens = Math.max(0, usage.prompt - cached);
  return {
    inputTokens,
    cachedInputTokens: cached,
    outputTokens: usage.completion,
    reasoningTokens: usage.reasoning ?? 0,
    totalTokens: usage.total,
    requestId: usage.requestId ?? null,
    actualModel: usage.actualModel ?? fallbackModel ?? null,
  };
}

export function mergeLlmUsageDetails(parts: LlmUsageDetails[]): LlmUsageDetails {
  const merged = emptyLlmUsageDetails();
  for (const part of parts) {
    merged.inputTokens += part.inputTokens;
    merged.cachedInputTokens += part.cachedInputTokens;
    merged.outputTokens += part.outputTokens;
    merged.reasoningTokens += part.reasoningTokens;
    merged.totalTokens += part.totalTokens;
    if (part.requestId) merged.requestId = part.requestId;
    if (part.actualModel) merged.actualModel = part.actualModel;
  }
  return merged;
}
