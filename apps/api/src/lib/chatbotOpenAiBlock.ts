import { assistOpenAiModel, resolveAssistLlmForOrganization } from "./agentAssistLlm.js";
import { AssistLlmError, callAssistLlmChat } from "./assistLlmBilling.js";

export async function runChatbotOpenAiBlock(params: {
  organizationId: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  conversationId?: string | null;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const assist = await resolveAssistLlmForOrganization(params.organizationId);
  if (!assist.ok) {
    return {
      ok: false,
      error:
        assist.reason === "insufficient_balance"
          ? "Créditos de IA insuficientes."
          : "OpenAI não configurado (chave da organização ou servidor).",
    };
  }
  const model = params.model?.trim() || assistOpenAiModel();
  const system =
    params.systemPrompt?.trim() ||
    "Responde de forma concisa e útil. Devolve apenas o texto pedido, sem markdown desnecessário.";
  try {
    const { text } = await callAssistLlmChat(
      assist.ctx,
      {
        model,
        temperature: 0.4,
        maxTokens: Math.min(Math.max(params.maxTokens ?? 512, 64), 2000),
        system,
        history: [],
        userMessage: params.prompt,
        signal: AbortSignal.timeout(45_000),
      },
      { conversationId: params.conversationId ?? null },
    );
    return { ok: true, text: text.trim() };
  } catch (err) {
    if (err instanceof AssistLlmError && err.code === "insufficient_balance") {
      return { ok: false, error: "Créditos de IA insuficientes." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Erro OpenAI" };
  }
}
