/** Provedores LLM suportados no runtime de agentes e pré-visualização. */
export type LlmProviderId = "openai" | "google_gemini" | "kimi" | "xai" | "anthropic";

export const LLM_PROVIDER_IDS = ["openai", "google_gemini", "kimi", "xai", "anthropic"] as const satisfies readonly LlmProviderId[];

export function isGeminiProvider(provider: string): boolean {
  return provider === "google_gemini";
}

export function isAnthropicProvider(provider: string): boolean {
  return provider === "anthropic";
}

/** OpenAI-compatible (inclui Kimi / Moonshot e xAI Grok). */
export function isOpenAiCompatibleProvider(provider: string): boolean {
  return !isGeminiProvider(provider) && !isAnthropicProvider(provider);
}

type PlatformKeys = {
  openAiPromptPreviewKey: string;
  geminiPromptPreviewKey: string;
  kimiPromptPreviewKey: string;
  xaiPromptPreviewKey: string;
  anthropicPromptPreviewKey: string;
};

export function resolvePlatformLlmApiKey(provider: string, storedKey: string, keys: PlatformKeys): string {
  const trimmed = storedKey.trim();
  if (trimmed && trimmed !== "***") return trimmed;
  if (provider === "openai") return keys.openAiPromptPreviewKey.trim();
  if (provider === "google_gemini") return keys.geminiPromptPreviewKey.trim();
  if (provider === "kimi") return keys.kimiPromptPreviewKey.trim();
  if (provider === "xai") return keys.xaiPromptPreviewKey.trim();
  if (provider === "anthropic") return keys.anthropicPromptPreviewKey.trim();
  return "";
}

type PlatformUrls = {
  openAiApiBaseUrl: string;
  kimiApiBaseUrl: string;
  xaiApiBaseUrl: string;
  anthropicApiBaseUrl: string;
};

export function resolveLlmApiBaseUrl(provider: string, storedUrl: string, urls: PlatformUrls): string {
  const trimmed = storedUrl.trim().replace(/\/+$/, "");
  if (trimmed) return trimmed;
  if (provider === "google_gemini") return "https://generativelanguage.googleapis.com";
  if (provider === "kimi") return urls.kimiApiBaseUrl;
  if (provider === "xai") return urls.xaiApiBaseUrl;
  if (provider === "anthropic") return urls.anthropicApiBaseUrl;
  return urls.openAiApiBaseUrl || "https://api.openai.com/v1";
}

export function platformLlmKeySource(provider: string, storedKey: string, keys: PlatformKeys): string {
  if (storedKey.trim() && storedKey.trim() !== "***") return "profile";
  if (provider === "openai" && keys.openAiPromptPreviewKey.trim()) return "server_openai_env";
  if (provider === "google_gemini" && keys.geminiPromptPreviewKey.trim()) return "server_gemini_env";
  if (provider === "kimi" && keys.kimiPromptPreviewKey.trim()) return "server_kimi_env";
  if (provider === "xai" && keys.xaiPromptPreviewKey.trim()) return "server_xai_env";
  if (provider === "anthropic" && keys.anthropicPromptPreviewKey.trim()) return "server_anthropic_env";
  return "none";
}
