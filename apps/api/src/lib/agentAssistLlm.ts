import { config } from "../config.js";
import { callOpenAiCompatibleChat } from "./promptModulePreviewLlm.js";

export function openAiKeyForAssistFeatures(): string | null {
  const k = config.openAiPromptPreviewKey.trim();
  return k || null;
}

export function assistOpenAiModel(): string {
  return process.env.OPENAI_ASSIST_MODEL?.trim() || "gpt-4o-mini";
}

type PublicMsg = { direction: string; body: string | null; isPrivate?: boolean | null };

/** Mensagens visíveis ao cliente (exclui notas internas) para contexto do modelo. */
export function buildPublicConversationTranscript(messages: PublicMsg[], maxMessages = 50): string {
  const lines: string[] = [];
  const slice = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;
  for (const m of slice) {
    if (m.isPrivate) continue;
    const b = (m.body ?? "").trim();
    if (!b) continue;
    const label = m.direction === "INBOUND" ? "Cliente" : "Atendente";
    lines.push(`${label}: ${b}`);
  }
  return lines.join("\n");
}

export async function suggestAgentReplyText(input: {
  contactName: string;
  transcript: string;
  currentDraft?: string;
}): Promise<string> {
  const apiKey = openAiKeyForAssistFeatures();
  if (!apiKey) {
    throw new Error("missing_openai_key");
  }

  const system = [
    "És um assistente que ajuda agentes de suporte a redigirem a próxima mensagem ao cliente (WhatsApp ou canal semelhante).",
    "Regras: usa a mesma língua que o cliente na última troca; tom profissional e conciso; não inventes factos, preços nem políticas da empresa; se faltar informação, faz perguntas claras e breves ao cliente.",
    "Devolve APENAS o texto da mensagem a enviar ao cliente, sem aspas, sem prefixos «Cliente:»/«Atendente:», sem markdown.",
  ].join(" ");

  const userParts = [
    `Nome do contacto (referência): ${input.contactName.trim() || "—"}`,
    "",
    "Histórico recente (Cliente = mensagens recebidas, Atendente = respostas enviadas):",
    input.transcript.trim() || "(sem mensagens de texto públicas)",
  ];
  if (input.currentDraft?.trim()) {
    userParts.push("", "Rascunho actual do agente (podes melhorar ou substituir):", input.currentDraft.trim());
  }

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: config.openAiApiBaseUrl,
    apiKey,
    model: assistOpenAiModel(),
    temperature: 0.45,
    maxTokens: 700,
    system,
    history: [],
    userMessage: userParts.join("\n"),
    signal: AbortSignal.timeout(45_000),
  });
  const out = text.trim();
  if (!out) throw new Error("empty_suggestion");
  return out.slice(0, 8000);
}

export type ConversationInsightPayload = {
  summary: string;
  intent: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  suggestedActions: string[];
  conversionOutlook: string;
  alerts: string[];
};

const SENTIMENTS = new Set(["positive", "neutral", "negative", "frustrated"]);

function normalizeInsights(raw: unknown): ConversationInsightPayload {
  const fallback = (s: string): ConversationInsightPayload => ({
    summary: s,
    intent: "—",
    sentiment: "neutral",
    suggestedActions: [],
    conversionOutlook: "—",
    alerts: [],
  });
  if (!raw || typeof raw !== "object") return fallback("Análise indisponível.");
  const o = raw as Record<string, unknown>;
  const sentimentRaw = typeof o.sentiment === "string" ? o.sentiment.toLowerCase().trim() : "neutral";
  const sentiment = SENTIMENTS.has(sentimentRaw) ? (sentimentRaw as ConversationInsightPayload["sentiment"]) : "neutral";
  const suggestedActions = Array.isArray(o.suggestedActions)
    ? o.suggestedActions.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 5)
    : [];
  const alerts = Array.isArray(o.alerts)
    ? o.alerts.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 3)
    : [];
  return {
    summary: typeof o.summary === "string" ? o.summary.trim().slice(0, 2000) : "—",
    intent: typeof o.intent === "string" ? o.intent.trim().slice(0, 500) : "—",
    sentiment,
    suggestedActions,
    conversionOutlook:
      typeof o.conversionOutlook === "string" ? o.conversionOutlook.trim().slice(0, 500) : "—",
    alerts,
  };
}

export async function analyzeConversationForInsights(input: {
  contactName: string;
  transcript: string;
}): Promise<ConversationInsightPayload> {
  const apiKey = openAiKeyForAssistFeatures();
  if (!apiKey) {
    throw new Error("missing_openai_key");
  }

  const system = [
    "És um analista de CRM. Analisa o histórico de chat entre cliente e atendente.",
    "Responde APENAS com um único objecto JSON válido (sem markdown, sem texto antes ou depois), com as chaves:",
    '{"summary":"string breve do estado da conversa","intent":"intenção principal do cliente","sentiment":"positive|neutral|negative|frustrated","suggestedActions":["até 5 acções concretas para o atendente"],"conversionOutlook":"uma frase sobre probabilidade de conversão ou próximo passo comercial","alerts":["até 3 alertas ou riscos (tempo de resposta, insatisfação, etc.)"]}',
    "Usa a mesma língua do histórico para os valores em texto.",
  ].join(" ");

  const userMessage = [
    `Contacto: ${input.contactName.trim() || "—"}`,
    "",
    "Histórico:",
    input.transcript.trim() || "(vazio)",
  ].join("\n");

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: config.openAiApiBaseUrl,
    apiKey,
    model: assistOpenAiModel(),
    temperature: 0.35,
    maxTokens: 900,
    system,
    history: [],
    userMessage,
    signal: AbortSignal.timeout(55_000),
  });

  let parsed: unknown;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    return normalizeInsights({
      summary: text.trim().slice(0, 2000) || "Análise indisponível.",
      intent: "—",
      sentiment: "neutral",
      suggestedActions: [],
      conversionOutlook: "—",
      alerts: [],
    });
  }
  return normalizeInsights(parsed);
}
