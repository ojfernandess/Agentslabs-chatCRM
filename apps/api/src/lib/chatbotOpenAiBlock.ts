import { getAssistOpenAiCredentialsForOrganization, assistOpenAiModel } from "./agentAssistLlm.js";
import { callOpenAiCompatibleChat } from "./promptModulePreviewLlm.js";

export async function runChatbotOpenAiBlock(params: {
  organizationId: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const creds = await getAssistOpenAiCredentialsForOrganization(params.organizationId);
  if (!creds) {
    return { ok: false, error: "OpenAI não configurado (chave da organização ou servidor)." };
  }
  const model = params.model?.trim() || assistOpenAiModel();
  const system =
    params.systemPrompt?.trim() ||
    "Responde de forma concisa e útil. Devolve apenas o texto pedido, sem markdown desnecessário.";
  try {
    const { text } = await callOpenAiCompatibleChat({
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      model,
      temperature: 0.4,
      maxTokens: Math.min(Math.max(params.maxTokens ?? 512, 64), 2000),
      system,
      history: [],
      userMessage: params.prompt,
      signal: AbortSignal.timeout(45_000),
    });
    return { ok: true, text: text.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro OpenAI" };
  }
}
