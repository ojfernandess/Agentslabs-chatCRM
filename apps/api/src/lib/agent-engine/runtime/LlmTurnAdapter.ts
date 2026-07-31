/**
 * Fase 2c — adaptador LLM isolado do monolito.
 * Responsável apenas por invocar o modelo (texto); plan/contract vive no ExecutionEngine.
 */
import {
  callGeminiGenerateContent,
  callOpenAiCompatibleChat,
  type PreviewChatTurn,
} from "../../promptModulePreviewLlm.js";

export type LlmTextGenerationInput = {
  provider: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  temperature: number;
  maxTokens: number;
  system: string;
  history: PreviewChatTurn[];
  userMessage: string;
  signal: AbortSignal;
  onTokenDelta?: (delta: string) => void;
};

export function clampLlmMaxTokens(maxTokens: number): number {
  return Math.max(16, Math.min(8192, maxTokens));
}

/** Geração de texto sem tools — Gemini ou OpenAI-compatible. */
export async function invokeLlmTextGeneration(
  input: LlmTextGenerationInput,
): Promise<{ text: string }> {
  const maxTokens = clampLlmMaxTokens(input.maxTokens);
  if (input.provider === "google_gemini") {
    const r = await callGeminiGenerateContent({
      apiKey: input.apiKey,
      model: input.model,
      temperature: input.temperature,
      maxTokens,
      system: input.system,
      history: input.history,
      userMessage: input.userMessage,
      signal: input.signal,
    });
    return { text: r.text.trim() };
  }
  const r = await callOpenAiCompatibleChat({
    baseUrl: input.apiBaseUrl.replace(/\/+$/, ""),
    apiKey: input.apiKey,
    model: input.model,
    temperature: input.temperature,
    maxTokens,
    system: input.system,
    history: input.history,
    userMessage: input.userMessage,
    signal: input.signal,
    onTokenDelta: input.onTokenDelta,
  });
  return { text: r.text.trim() };
}
