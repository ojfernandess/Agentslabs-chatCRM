import { config } from "../../config.js";
import {
  platformLlmKeySource,
  resolveLlmApiBaseUrl,
  resolvePlatformLlmApiKey,
  type LlmProviderId,
} from "../llmProviders.js";
import { getOrganizationAiBillingMode } from "./getOrganizationAiBillingMode.js";
import type { AiBillingMode } from "./aiBillingTypes.js";

export type ResolvedAgentLlmCredentials = {
  provider: string;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  billingMode: AiBillingMode;
  keySource: string;
};

function llmConfigString(cfg: Record<string, unknown>, key: string): string {
  const value = cfg[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolvePlatformCreditsProvider(): LlmProviderId {
  const configured = config.platformCreditsLlmProvider.trim().toLowerCase();
  if (
    configured === "openai" ||
    configured === "google_gemini" ||
    configured === "kimi" ||
    configured === "xai" ||
    configured === "anthropic"
  ) {
    return configured;
  }
  return "openai";
}

export function resolveAgentLlmCredentialsForMode(
  billingMode: AiBillingMode,
  llmConfig: Record<string, unknown>,
): ResolvedAgentLlmCredentials {
  const model = llmConfigString(llmConfig, "model") || "gpt-4o-mini";

  if (billingMode === "PLATFORM_CREDITS") {
    const provider = resolvePlatformCreditsProvider();
    const apiKey = resolvePlatformLlmApiKey(provider, "", config);
    const apiBaseUrl = resolveLlmApiBaseUrl(provider, "", config);
    return {
      provider,
      model,
      apiKey,
      apiBaseUrl,
      billingMode,
      keySource: apiKey ? "platform_credits" : "none",
    };
  }

  const provider = llmConfigString(llmConfig, "provider") || "openai";
  const storedKey = llmConfigString(llmConfig, "apiKey");
  const storedUrl = llmConfigString(llmConfig, "apiBaseUrl");
  const apiKey = resolvePlatformLlmApiKey(provider, storedKey, config);
  const apiBaseUrl = resolveLlmApiBaseUrl(provider, storedUrl, config);

  return {
    provider,
    model,
    apiKey,
    apiBaseUrl,
    billingMode,
    keySource: platformLlmKeySource(provider, storedKey, config),
  };
}

/**
 * Resolve credenciais LLM do agente conforme o modo de faturação da organização.
 * OWN_API_KEY: comportamento actual (perfil → fallback env).
 * PLATFORM_CREDITS: credencial central da plataforma; ignora provider/apiKey do perfil na execução.
 */
export async function resolveAgentLlmCredentials(input: {
  organizationId: string;
  llmConfig: Record<string, unknown>;
}): Promise<ResolvedAgentLlmCredentials> {
  const billingMode = await getOrganizationAiBillingMode(input.organizationId);
  return resolveAgentLlmCredentialsForMode(billingMode, input.llmConfig);
}
