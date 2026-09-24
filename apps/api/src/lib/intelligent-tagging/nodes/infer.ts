import {
  assistOpenAiModel,
  buildPublicConversationTranscript,
  resolveAssistLlmForOrganization,
} from "../../agentAssistLlm.js";
import { callAssistLlmChat, type ResolvedAssistLlmContext } from "../../assistLlmBilling.js";
import type {
  InferTagsFn,
  IntelligentTaggingGraphState,
  IntelligentTaggingTrigger,
  LlmTaggingResult,
} from "../types.js";
import { DURING_CONVERSATION_MAX_TAGS } from "../types.js";
import { enrichTagCatalogForLlm, parseLlmTaggingResponse } from "./helpers.js";

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
  ctx: ResolvedAssistLlmContext;
  conversationId?: string | null;
}): Promise<LlmTaggingResult> {
  const duringConversation = input.trigger === "during_conversation";
  const effectiveMaxTags = duringConversation
    ? Math.min(input.maxTags, DURING_CONVERSATION_MAX_TAGS)
    : input.maxTags;

  const catalogJson = JSON.stringify(enrichTagCatalogForLlm(input.tagCatalog));

  const systemParts = [
    "És um classificador de CRM especializado em intenção do cliente.",
    "Responde APENAS com JSON válido:",
    '{"primaryIntent":"quote|complaint|question|support|payment|scheduling|sales|other|none","tags":[{"tagId":"uuid","tagName":"nome","confidence":0.0-1.0,"rationale":"cita trecho da mensagem actual","suggestedNewTag":false}],"suggestedNewTags":[]}',
    `Escolhe no máximo ${effectiveMaxTags} etiqueta(s). confidence = certeza (0-1).`,
    "Só uses tagId/tagName do catálogo (campo hint explica quando cada etiqueta se aplica).",
    "Se nenhuma etiqueta do catálogo corresponder com clareza, devolve tags:[] e primaryIntent:\"none\".",
    "Preferência: precisão sobre cobertura — melhor zero etiquetas do que etiqueta errada.",
  ];

  if (duringConversation) {
    systemParts.push(
      "Modo TEMPO REAL (during_conversation):",
      "1) Lê primaryIntent com base APENAS na(s) linha(s) «mensagem actual».",
      "2) Mapeia primaryIntent → etiqueta cujo hint/nome seja coerente (ex.: quote→Cotação/Orçamento; complaint→Reclamação; question→Dúvida).",
      "3) Ignora temas do «contexto anterior» ou mensagens antigas já tratadas.",
      "4) rationale DEVE citar palavras ou paráfrase curta da mensagem actual.",
      "5) Não repitas etiquetas já no contacto salvo nova evidência clara na mensagem actual.",
      "6) Mensagens genéricas (oi, ok, obrigado, sim) → primaryIntent:none e tags:[].",
      "7) Uma mensagem = no máximo 1 etiqueta principal (a mais específica).",
    );
  } else {
    systemParts.push(
      "Considera temas, intenção, urgência e tipo de pedido ao longo da conversa.",
      "primaryIntent resume o motivo principal do contacto.",
    );
  }

  const system = systemParts.join(" ");

  const userParts = [
    `Contacto: ${input.contactName || "—"}`,
    `Metadados: ${input.metadataSummary}`,
  ];
  if (input.existingTagNames.length) {
    userParts.push(`Etiquetas já no contacto (evitar repetir): ${input.existingTagNames.join(", ")}`);
  }
  if (!duringConversation && input.mem0Context.trim()) {
    userParts.push(`Contexto histórico (Mem0): ${input.mem0Context.trim()}`);
  }
  userParts.push(`Catálogo (id, name, hint): ${catalogJson}`, "", "Conversa:", input.transcript.trim() || "(vazio)");

  const { text } = await callAssistLlmChat(
    input.ctx,
    {
      temperature: duringConversation ? 0.05 : 0.2,
      maxTokens: 800,
      system,
      history: [],
      userMessage: userParts.join("\n"),
      signal: AbortSignal.timeout(55_000),
    },
    { conversationId: input.conversationId ?? null },
  );

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { classifications: [], suggestedNewTags: [] };
  }

  const result = parseLlmTaggingResponse(parsed, input.tagCatalog);

  if (parsed && typeof parsed === "object") {
    const primaryIntent = (parsed as Record<string, unknown>).primaryIntent;
    if (duringConversation && primaryIntent === "none") {
      return { classifications: [], suggestedNewTags: [] };
    }
  }

  return {
    classifications: result.classifications.slice(0, effectiveMaxTags),
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
      const resolved = await resolveAssistLlmForOrganization(state.organizationId);
      if (!resolved.ok) {
        throw new Error("openai_not_configured");
      }
      return inferTagsWithLlm({
        ...input,
        ctx: resolved.ctx,
        conversationId: state.conversationId ?? null,
      });
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
