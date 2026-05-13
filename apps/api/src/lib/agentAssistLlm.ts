import { config } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import { callOpenAiCompatibleChat } from "./promptModulePreviewLlm.js";

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
 * Chave OpenAI para assistência no painel: primeiro `settings` da organização, senão servidor.
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

export async function suggestAgentReplyText(
  input: {
    contactName: string;
    transcript: string;
    currentDraft?: string;
    language?: string;
    crmContext?: {
      tags?: string[];
      pipelineStage?: string;
      recentDeals?: { name: string; amountCents: number; status: string; currency: string }[];
    };
  },
  credentials: AssistOpenAiCredentials,
): Promise<string> {
  const lang = input.language || "pt";
  const systemPrompts: Record<string, string[]> = {
    pt: [
      "És um assistente que ajuda agentes de suporte a redigirem a próxima mensagem ao cliente (WhatsApp ou canal semelhante).",
      "Regras: usa a mesma língua que o cliente na última troca; tom profissional e conciso; não inventes factos, preços nem políticas da empresa; se faltar informação, faz perguntas claras e breves ao cliente.",
      "Devolve APENAS o texto da mensagem a enviar ao cliente, sem aspas, sem prefixos «Cliente:»/«Atendente:», sem markdown.",
    ],
    en: [
      "You are an assistant that helps support agents write the next message to the customer (WhatsApp or similar channel).",
      "Rules: use the same language as the customer in the last exchange; professional and concise tone; do not invent facts, prices, or company policies; if information is missing, ask clear and brief questions to the customer.",
      "Return ONLY the text of the message to be sent to the customer, without quotes, without prefixes like 'Customer:'/'Agent:', without markdown.",
    ],
    es: [
      "Eres un asistente que ayuda a los agentes de soporte a redactar el próximo mensaje al cliente (WhatsApp o canal similar).",
      "Reglas: usa el mismo idioma que el cliente en el último intercambio; tono profesional y conciso; no inventes hechos, precios ni políticas de la empresa; si falta información, haz preguntas claras y breves al cliente.",
      "Devuelve SOLO el texto del mensaje a enviar al cliente, sin comillas, sin prefijos 'Cliente:'/'Agente:', sin markdown.",
    ],
  };

  const system = (systemPrompts[lang] || systemPrompts["pt"]).join(" ");

  const userParts = [
    lang === "en" ? `Contact name (reference): ${input.contactName.trim() || "—"}` :
    lang === "es" ? `Nombre del contacto (referencia): ${input.contactName.trim() || "—"}` :
    `Nome do contacto (referência): ${input.contactName.trim() || "—"}`,
  ];

  if (input.crmContext) {
    const { tags, pipelineStage, recentDeals } = input.crmContext;
    if (tags?.length) {
      userParts.push(lang === "en" ? `Tags: ${tags.join(", ")}` : lang === "es" ? `Etiquetas: ${tags.join(", ")}` : `Etiquetas: ${tags.join(", ")}`);
    }
    if (pipelineStage) {
      userParts.push(lang === "en" ? `Funnel Stage: ${pipelineStage}` : lang === "es" ? `Etapa del embudo: ${pipelineStage}` : `Estágio do funil: ${pipelineStage}`);
    }
    if (recentDeals?.length) {
      const dealsStr = recentDeals.map(d => `${d.name} (${(d.amountCents / 100).toFixed(2)} ${d.currency} - ${d.status})`).join("; ");
      userParts.push(lang === "en" ? `Recent Deals: ${dealsStr}` : lang === "es" ? `Negocios recientes: ${dealsStr}` : `Negócios recentes: ${dealsStr}`);
    }
  }

  userParts.push(
    "",
    lang === "en" ? "Recent history (Customer = received messages, Agent = sent replies):" :
    lang === "es" ? "Historial reciente (Cliente = mensajes recibidos, Agente = respuestas enviadas):" :
    "Histórico recente (Cliente = mensagens recebidas, Atendente = respostas enviadas):",
    input.transcript.trim() || (lang === "en" ? "(no public text messages)" : lang === "es" ? "(sin mensajes de texto públicos)" : "(sem mensagens de texto públicas)"),
  );
  if (input.currentDraft?.trim()) {
    userParts.push(
      "",
      lang === "en" ? "Current agent draft (you can improve or replace it):" :
      lang === "es" ? "Borrador actual del agente (puedes mejorarlo o reemplazarlo):" :
      "Rascunho actual do agente (podes melhorar ou substituir):",
      input.currentDraft.trim()
    );
  }

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
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

export async function analyzeConversationForInsights(
  input: {
    contactName: string;
    transcript: string;
    language?: string;
    crmContext?: {
      tags?: string[];
      pipelineStage?: string;
      recentDeals?: { name: string; amountCents: number; status: string; currency: string }[];
    };
  },
  credentials: AssistOpenAiCredentials,
): Promise<ConversationInsightPayload> {
  const lang = input.language || "pt";
  const systemPrompts: Record<string, string[]> = {
    pt: [
      "És um analista de CRM. Analisa o histórico de chat entre cliente e atendente.",
      "Responde APENAS com um único objecto JSON válido (sem markdown, sem texto antes ou depois), com as chaves:",
      '{"summary":"string breve do estado da conversa","intent":"intenção principal do cliente","sentiment":"positive|neutral|negative|frustrated","suggestedActions":["até 5 acções concretas para o atendente"],"conversionOutlook":"uma frase sobre probabilidade de conversão ou próximo passo comercial","alerts":["até 3 alertas ou riscos (tempo de resposta, insatisfação, etc.)"]}',
      "Usa a mesma língua do histórico para os valores em texto.",
    ],
    en: [
      "You are a CRM analyst. Analyze the chat history between the customer and the agent.",
      "Respond ONLY with a single valid JSON object (no markdown, no text before or after), with the keys:",
      '{"summary":"brief string of the conversation state","intent":"main intent of the customer","sentiment":"positive|neutral|negative|frustrated","suggestedActions":["up to 5 concrete actions for the agent"],"conversionOutlook":"a sentence about conversion probability or next commercial step","alerts":["up to 3 alerts or risks (response time, dissatisfaction, etc.)"]}',
      "Use the same language as the history for the text values.",
    ],
    es: [
      "Eres un analista de CRM. Analiza el historial de chat entre el cliente y el agente.",
      "Responde SOLO con un único objeto JSON válido (sin markdown, sin texto antes o después), con las claves:",
      '{"summary":"cadena breve del estado de la conversación","intent":"intención principal del cliente","sentiment":"positive|neutral|negative|frustrated","suggestedActions":["hasta 5 acciones concretas para el agente"],"conversionOutlook":"una frase sobre la probabilidad de conversión o el próximo paso comercial","alerts":["hasta 3 alertas o riesgos (tiempo de respuesta, insatisfacción, etc.)"]}',
      "Usa el mismo idioma que el historial para los valores de texto.",
    ],
  };

  const system = (systemPrompts[lang] || systemPrompts["pt"]).join(" ");

  const userParts = [
    lang === "en" ? `Contact: ${input.contactName.trim() || "—"}` :
    lang === "es" ? `Contacto: ${input.contactName.trim() || "—"}` :
    `Contacto: ${input.contactName.trim() || "—"}`,
  ];

  if (input.crmContext) {
    const { tags, pipelineStage, recentDeals } = input.crmContext;
    if (tags?.length) {
      userParts.push(lang === "en" ? `Tags: ${tags.join(", ")}` : lang === "es" ? `Etiquetas: ${tags.join(", ")}` : `Etiquetas: ${tags.join(", ")}`);
    }
    if (pipelineStage) {
      userParts.push(lang === "en" ? `Funnel Stage: ${pipelineStage}` : lang === "es" ? `Etapa del embudo: ${pipelineStage}` : `Estágio do funil: ${pipelineStage}`);
    }
    if (recentDeals?.length) {
      const dealsStr = recentDeals.map(d => `${d.name} (${(d.amountCents / 100).toFixed(2)} ${d.currency} - ${d.status})`).join("; ");
      userParts.push(lang === "en" ? `Recent Deals: ${dealsStr}` : lang === "es" ? `Negocios recientes: ${dealsStr}` : `Negócios recentes: ${dealsStr}`);
    }
  }

  userParts.push(
    "",
    lang === "en" ? "History:" : lang === "es" ? "Historial:" : "Histórico:",
    input.transcript.trim() || (lang === "en" ? "(empty)" : lang === "es" ? "(vacío)" : "(vazio)"),
  );

  const userMessage = userParts.join("\n");

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
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

export type AggregateHealthPayload = {
  overallHealth: "good" | "neutral" | "concerning" | "critical";
  summary: string;
  topIssues: string[];
  recommendations: string[];
};

export async function analyzeAggregateHealth(
  insights: ConversationInsightPayload[],
  credentials: AssistOpenAiCredentials,
  language = "pt"
): Promise<AggregateHealthPayload> {
  const systemPrompts: Record<string, string[]> = {
    pt: [
      "És um gestor de suporte. Analisa os resumos de várias conversas e fornece um relatório de saúde da fila.",
      "Responde APENAS com um único objecto JSON válido (sem markdown), com as chaves:",
      '{"overallHealth":"good|neutral|concerning|critical","summary":"resumo executivo do estado da fila","topIssues":["até 3 problemas recorrentes"],"recommendations":["até 3 recomendações para a equipa"]}',
      "Usa a mesma língua que o input para os valores em texto.",
    ],
    en: [
      "You are a support manager. Analyze the summaries of multiple conversations and provide a queue health report.",
      "Respond ONLY with a single valid JSON object (no markdown), with the keys:",
      '{"overallHealth":"good|neutral|concerning|critical","summary":"executive summary of the queue state","topIssues":["up to 3 recurring issues"],"recommendations":["up to 3 recommendations for the team"]}',
      "Use the same language as the input for the text values.",
    ],
    es: [
      "Eres un gerente de soporte. Analiza los resúmenes de varias conversaciones y proporciona un informe de salud de la fila.",
      "Responde SOLO con un único objeto JSON válido (sin markdown), con las claves:",
      '{"overallHealth":"good|neutral|concerning|critical","summary":"resumen ejecutivo del estado de la fila","topIssues":["hasta 3 problemas recurrentes"],"recommendations":["hasta 3 recomendaciones para el equipo"]}',
      "Usa el mismo idioma que el input para los valores de texto.",
    ],
  };

  const system = (systemPrompts[language] || systemPrompts["pt"]).join(" ");

  const userMessage = [
    "Resumos das conversas:",
    JSON.stringify(insights.map(i => ({ summary: i.summary, sentiment: i.sentiment, alerts: i.alerts })), null, 2),
  ].join("\n");

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    model: assistOpenAiModel(),
    temperature: 0.3,
    maxTokens: 1000,
    system,
    history: [],
    userMessage,
    signal: AbortSignal.timeout(60_000),
  });

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as AggregateHealthPayload;
    return {
      overallHealth: parsed.overallHealth || "neutral",
      summary: parsed.summary || "Resumo indisponível.",
      topIssues: Array.isArray(parsed.topIssues) ? parsed.topIssues.slice(0, 3) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 3) : [],
    };
  } catch {
    return {
      overallHealth: "neutral",
      summary: "Falha ao processar análise agregada.",
      topIssues: [],
      recommendations: [],
    };
  }
}
