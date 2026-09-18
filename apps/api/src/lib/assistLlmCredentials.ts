import { config } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";

export type AssistOpenAiCredentials = { apiKey: string; baseUrl: string };

/** Só chave global do servidor (sem organização). */
export function serverAssistCredentials(): AssistOpenAiCredentials | null {
  const apiKey = config.openAiPromptPreviewKey.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: config.openAiApiBaseUrl.replace(/\/+$/, "") };
}

export function openAiKeyForAssistFeatures(): string | null {
  return serverAssistCredentials()?.apiKey ?? null;
}

/**
 * Chave OpenAI para assistência no painel (OWN_API_KEY): primeiro `settings` da organização, senão servidor.
 */
export async function getAssistOpenAiCredentialsForOrganization(
  organizationId: string,
): Promise<AssistOpenAiCredentials | null> {
  const row = await prisma.settings.findUnique({
    where: { organizationId },
    select: { assistantOpenaiApiKey: true, assistantOpenaiApiBaseUrl: true },
  });
  const orgKeyEncrypted = row?.assistantOpenaiApiKey?.trim();
  if (orgKeyEncrypted) {
    const orgKey = decrypt(orgKeyEncrypted);
    if (orgKey) {
      const baseRaw = row?.assistantOpenaiApiBaseUrl?.trim();
      const baseUrl = (baseRaw || config.openAiApiBaseUrl).replace(/\/+$/, "");
      return { apiKey: orgKey, baseUrl };
    }
  }
  return serverAssistCredentials();
}

export function assistOpenAiModel(): string {
  return process.env.OPENAI_ASSIST_MODEL?.trim() || "gpt-4o-mini";
}
