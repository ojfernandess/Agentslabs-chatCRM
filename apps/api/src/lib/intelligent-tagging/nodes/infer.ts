import {
  assistOpenAiModel,
  buildPublicConversationTranscript,
  getAssistOpenAiCredentialsForOrganization,
} from "../../agentAssistLlm.js";
import { callOpenAiCompatibleChat } from "../../promptModulePreviewLlm.js";
import type {
  InferTagsFn,
  IntelligentTaggingGraphState,
  IntelligentTaggingTrigger,
  LlmTaggingResult,
} from "../types.js";
import { parseLlmTaggingResponse } from "./helpers.js";

export async function inferTagsWithLlm(input: {
  contactName: string;
  transcript: string;
  metadataSummary: string;
  mem0Context: string;
  existingTagNames: string[];
  tagCatalog: Array<{ id: string; name: string; color: string }>;
  maxTags: number;
  language: string;
  trigger: IntelligentTaggingTrigger;
  credentials: { apiKey: string; baseUrl: string };
}): Promise<LlmTaggingResult> {
  const catalogJson = JSON.stringify(
    input.tagCatalog.map((t) => ({ id: t.id, name: t.name })),
  );
  const duringConversation = input.trigger === "during_conversation";

  const systemParts = [
    "És um classificador de CRM. Analisa a conversa e escolhe etiquetas EXISTENTES do catálogo.",
    "Responde APENAS com JSON válido:",
    '{"tags":[{"tagId":"uuid ou null","tagName":"nome","confidence":0.0-1.0,"rationale":"string","suggestedNewTag":false}],"suggestedNewTags":["nome se nenhuma etiqueta existente servir"]}',
    `Escolhe no máximo ${input.maxTags} etiquetas. confidence é probabilidade de acerto (0-1).`,
    "Só uses tagId/tagName do catálogo. Se nenhuma servir, suggestedNewTag=true e lista em suggestedNewTags.",
  ];
  if (duringConversation) {
    systemParts.push(
      "Modo tempo real: classifica APENAS com base na(s) mensagem(ns) do cliente marcada(s) como «mensagem actual».",
      "Ignora temas de mensagens anteriores ou de contexto já resolvido. Se a mensagem actual não justificar nova etiqueta, devolve tags vazio.",
      "Não repitas etiquetas que o contacto já tem, salvo se a mensagem actual exigir claramente uma etiqueta diferente.",
    );
  } else {
    systemParts.push("Considera temas, intenção, urgência e tipo de problema.");
  }
  const system = systemParts.join(" ");

  const userParts = [
    `Contacto: ${input.contactName || "—"}`,
    `Metadados: ${input.metadataSummary}`,
  ];
  if (input.existingTagNames.length) {
    userParts.push(`Etiquetas já no contacto: ${input.existingTagNames.join(", ")}`);
  }
  if (!duringConversation && input.mem0Context.trim()) {
    userParts.push(`Contexto histórico (Mem0): ${input.mem0Context.trim()}`);
  }
  userParts.push(`Catálogo de etiquetas: ${catalogJson}`, "", "Conversa:", input.transcript.trim() || "(vazio)");

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: input.credentials.baseUrl,
    apiKey: input.credentials.apiKey,
    model: assistOpenAiModel(),
    temperature: 0.2,
    maxTokens: 800,
    system,
    history: [],
    userMessage: userParts.join("\n"),
    signal: AbortSignal.timeout(55_000),
  });

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { classifications: [], suggestedNewTags: [] };
  }

  const result = parseLlmTaggingResponse(parsed, input.tagCatalog);
  return {
    classifications: result.classifications.slice(0, input.maxTags),
    suggestedNewTags: result.suggestedNewTags,
  };
}

export async function inferNode(
  state: IntelligentTaggingGraphState,
  inferFn?: InferTagsFn,
): Promise<Partial<IntelligentTaggingGraphState>> {
  if (state.error) return {};

  const infer =
    inferFn ??
    (async (input) => {
      const credentials = await getAssistOpenAiCredentialsForOrganization(state.organizationId);
      if (!credentials) {
        throw new Error("openai_not_configured");
      }
      return inferTagsWithLlm({ ...input, credentials });
    });

  try {
    const result = await infer({
      contactName: state.contactName,
      transcript: state.transcript,
      metadataSummary: state.metadataSummary,
      mem0Context: state.mem0Context,
      existingTagNames: state.existingTagNames ?? [],
      tagCatalog: state.tagCatalog,
      maxTags: state.maxTags,
      language: state.language,
      trigger: state.trigger,
    });
    return {
      classifications: result.classifications,
      suggestedNewTags: result.suggestedNewTags,
      modelUsed: assistOpenAiModel(),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "infer_failed",
    };
  }
}

export { buildPublicConversationTranscript };
