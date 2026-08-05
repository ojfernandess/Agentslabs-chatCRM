import { extractQuerySegmentTokens, queryTerms } from "./knowledgeSearchRanking.js";
import { stripProactiveKnowledgeAppendixShell } from "./kbAppendix.js";
import { messageLooksLikeEscalationTurn } from "./agent-engine/escalation/escalationTurnDetection.js";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  userMessageLooksLikeAmenityItemQuestion,
  resolveEstablishmentInConversation,
  assistantRequestedEstablishmentForUnitKb,
} from "./unitKnowledgeFlow.js";

export type KnowledgeConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Tópicos factuais comuns em bases de conhecimento (sinónimos PT/EN). */
const TOPIC_SYNONYMS: Record<string, string[]> = {
  wifi: ["wifi", "wi-fi", "wi fi", "ssid", "rede wi", "internet", "wireless", "senha da rede", "nome da rede"],
  estacionamento: ["estacionamento", "parking", "vaga", "garagem", "estacionar"],
  cancelamento: ["cancelamento", "cancelar", "reembolso", "reembolsável"],
  checkin: ["check-in", "check in", "checkin", "entrada"],
  checkout: ["checkout", "check-out", "check out", "saída", "partida", "procedimento de checkout"],
  quartos: ["quarto", "quartos", "categorias", "suite", "suíte", "suites", "acomodação", "acomodacao", "capacidade", "camas"],
  localizacao: ["localização", "localizacao", "endereço", "endereco", "onde fica", "como chegar", "proximidades"],
  preco: ["preço", "preco", "valor", "diária", "diaria", "tarifa", "custo"],
  politica: ["política", "politica", "políticas", "regras", "proibido", "permitido", "funcionamento"],
  seguranca: ["segurança", "seguranca", "cctv", "câmera", "camera", "alarme"],
  alimentacao: ["café", "cafe", "breakfast", "restaurante", "delivery", "ifood", "vending"],
  reserva: ["reserva", "booking", "localizador", "confirmação", "confirmacao"],
};

const ESTABLISHMENT_DOC_RE =
  /\b([A-ZÀ-Ú][A-Za-zÀ-ú0-9\s.'-]{2,60})\s*(?:—|-)\s*Base de Conhecimento\b/g;

const OVERVIEW_META_RE =
  /se(?:c|c)ões com títulos|possíveis buscas|para consulta via buscar_conhecimento|documento da unidade/i;

function detectQueryTopics(normalizedQuery: string): string[] {
  const q = normalizedQuery.toLowerCase();
  const topics = new Set<string>();
  for (const [topic, syns] of Object.entries(TOPIC_SYNONYMS)) {
    if (syns.some((s) => q.includes(s)) || q.includes(topic)) topics.add(topic);
  }
  return [...topics];
}

function extractEstablishmentFromText(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(ESTABLISHMENT_DOC_RE)) {
    const n = m[1]?.trim();
    if (n && n.length >= 3) names.add(n);
  }
  for (const token of extractQuerySegmentTokens(text.toLowerCase())) {
    if (token.length >= 4) names.add(token);
  }
  return [...names];
}

type MarkdownSection = { title: string; body: string; level: number };

function parseMarkdownSections(text: string): MarkdownSection[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of normalized.split("\n")) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: "" };
      continue;
    }
    if (current) current.body += (current.body ? "\n" : "") + line;
  }
  if (current) sections.push(current);
  return sections;
}

function sectionHeaderMatchesTopics(title: string, topics: string[]): boolean {
  const header = title.toLowerCase();
  for (const topic of topics) {
    const syns = TOPIC_SYNONYMS[topic] ?? [topic];
    for (const s of syns) {
      const syn = s.toLowerCase();
      const headerKey = header.split("/")[0]?.trim() ?? header;
      if (header.includes(syn) || syn.includes(headerKey) || headerKey.includes(syn)) return true;
    }
  }
  return false;
}

/** Chunk intro/overview que só cataloga tópicos — não contém factos respondíveis. */
export function isKnowledgeOverviewChunk(text: string): boolean {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (OVERVIEW_META_RE.test(lower)) return true;

  const header = t.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? "";
  if (/base de conhecimento$/i.test(header) && !/^-\s+/m.test(t)) {
    const body = t.replace(/^#{1,6}\s+.+$/gm, "").trim();
    if (body.length < 420 && !/\*\*[^*]+:\*\*\s*\S/.test(body)) return true;
  }

  const commaTopics =
    (lower.match(/,\s*(?:wifi|estacionamento|cancelamento|check-in|localização|endereço|quartos)/gi) ?? []).length >= 2;
  if (commaTopics && /etc\.?\)?/i.test(lower)) return true;

  return false;
}

const SHORT_CONFIRMATION_RE =
  /^(sim|n[aã]o|nao|ok|okay|certo|correto|yes|no|obrigad[oa]|valeu|blz|beleza|confirmo|confirmado|pode ser|tudo bem|t[aá] bom|tb|tbm|tamb[eé]m|claro|perfeito|isso|isso mesmo|exato|exacto|combinado|pode|pode sim|aguardo|entendi|entendido|brasileiro|estrangeiro|male|female|masculino|feminino)\b/i;

const ASSISTANT_DATA_COLLECTION_RE =
  /\b(envie|envia|manda|mande|enviar|preciso\s+(do|da|de)|qual\s+(é|e)\s+o\s+seu|pode\s+enviar|fotografe|anexe|anexa|confirma\s+(o|a|os|as)|digite|informe|forne[cç]a|me\s+(diga|informe|envie)|cadastro|check[\s-]?in|localizador|cpf|documento|selfie|foto)\b/i;

const IMAGE_TRANSCRIPTION_PREFIX = "[Transcrição de imagem]";

/** Respostas curtas de menu / confirmação / fluxo — não disparam KB. */
export function isShortConfirmationOrFlowReply(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  if (t.length <= 3 && !/\?/.test(t)) return true;
  if (t.length <= 56 && SHORT_CONFIRMATION_RE.test(t)) return true;
  return false;
}

/** Cliente a fornecer dado de cadastro / fluxo (CPF, código, imagem) — não dispara KB. */
export function isUserDataProvisionMessage(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (t.includes(IMAGE_TRANSCRIPTION_PREFIX) || /^\[Imagem enviada pelo cliente\]$/i.test(t)) return true;
  if (/^\[Documento enviado pelo cliente\]$/i.test(t)) return true;
  const compact = t.replace(/\s+/g, "");
  if (/^[\d.\-\/]+$/.test(compact) && compact.replace(/\D/g, "").length >= 8) return true;
  if (/^[A-Z0-9\-_]{4,24}$/i.test(compact) && t.length <= 24) return true;
  if (
    t.length <= 64 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Última mensagem do agente pede recolha de dados (cadastro, check-in, documentos). */
export function assistantMessageIsDataCollection(assistantMessage: string): boolean {
  const t = assistantMessage.trim();
  if (!t) return false;
  if (ASSISTANT_DATA_COLLECTION_RE.test(t)) return true;
  if (
    /\?\s*$/.test(t) &&
    t.length < 480 &&
    /\b(cpf|cnpj|documento|nome|e-mail|email|telefone|celular|whatsapp|data|nascimento|foto|selfie|localizador|reserva|cadastro|h[oó]spede|acompanhante|passaporte|rg)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Mensagens que pedem factos da KB (endereço, Wi‑Fi, etc.) — não CPFs, localizadores ou respostas curtas de fluxo.
 */
export function userMessageLooksLikeKnowledgeSeekingQuery(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isUserDataProvisionMessage(t)) return false;
  if (isShortConfirmationOrFlowReply(t)) return false;
  if (isOperationalQuoteMessage(t)) return false;
  // C2/C3 — verificar/consultar/confirmar reserva ou check-in → API HTTP, nunca KB.
  if (userMessageLooksLikeReservationVerificationIntent(t)) {
    return false;
  }
  // Pedidos operacionais com localizador na mesma mensagem.
  if (isOperationalReservationLookupMessage(t)) {
    return false;
  }
  if (messageLooksLikeEscalationTurn(t)) {
    return false;
  }
  if (
    userMessageLooksLikeCheckoutProcedureQuestion(t) ||
    userMessageLooksLikeReceiptOrInvoiceRequest(t) ||
    userMessageLooksLikeAmenityItemQuestion(t)
  ) {
    return false;
  }
  if (/\?/.test(t)) return true;
  if (
    /\b(qual|quais|onde|como|quando|quanto|endere[cç]o|wifi|wi[\s-]?fi|senha|hor[aá]rio|pre[cç]o|estacionamento|pol[ií]tica|cancelamento|comodidade|what|where|how|when|address|password|parking|categorias?|quartos?)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length >= 28 && /[\p{L}]{4,}/u.test(t)) return true;
  return false;
}

export type KnowledgeSearchSkipReason =
  | "short_confirmation"
  | "data_provision"
  | "cadastro_turn"
  | "active_flow"
  | "checkin_reservation_turn";

export type KnowledgeSearchSkipContext = {
  lastAssistantMessage?: string;
  flowStep?: string;
  hasFlowSlots?: boolean;
  lastToolRoundHadHttpTools?: boolean;
  /** Tools de lookup de reserva já agendadas/executadas neste turno (Scheduler). */
  reservationLookupScheduled?: boolean;
};

/** Localizador de reserva — exige pelo menos um dígito (evita falso positivo em palavras PT). */
export const RESERVATION_REFERENCE_CODE_RE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i;

export function extractReservationReferenceFromMessage(userMessage: string): string | null {
  const t = (userMessage ?? "").trim();
  if (!t) return null;
  const m = t.match(RESERVATION_REFERENCE_CODE_RE);
  return m?.[0]?.toUpperCase() ?? null;
}

export function messageContainsReservationLocator(userMessage: string): boolean {
  return extractReservationReferenceFromMessage(userMessage) !== null;
}

/**
 * C3 operacional — hóspede quer *fazer* check-in (não FAQ «como funciona»).
 */
export function userMessageLooksLikeOperationalCheckinIntent(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (/\bcomo\s+funciona\b/i.test(t)) return false;
  if (
    /\bhor[aá]rio\b/i.test(t) &&
    /\bcheck[- ]?in\b/i.test(t) &&
    !/\b(?:fazer|fa[cç]o|realizar|quero)\b/i.test(t)
  ) {
    return false;
  }
  if (/\b(?:fazer|quero|preciso|gostaria\s+de|realizar)\s+(?:o\s+|de\s+)?check[- ]?in\b/i.test(t)) {
    return true;
  }
  if (/\bcomo\s+(?:eu\s+)?fa[cç]o\b/i.test(t) && /\bcheck[- ]?in\b/i.test(t)) return true;
  return false;
}

/** «Qual o link?» após turno de check-in — continua fluxo C3, não KB. */
export function userMessageLooksLikeCheckinLinkFollowUp(
  userMessage: string,
  lastAssistantMessage?: string | null,
): boolean {
  const t = userMessage.trim();
  if (!/^\s*(?:qual|cad[eê])\s+(?:o\s+)?link\b/i.test(t)) return false;
  const last = (lastAssistantMessage ?? "").trim();
  if (!last) return false;
  return /\bcheck[- ]?in\b|localizador|checkin\.audaar|pms\.audaar\.com\.br\/checkin/i.test(last);
}

/**
 * C2/C3 — intenção de verificar/consultar/confirmar reserva ou fazer check-in
 * (com ou sem localizador na mensagem).
 */
export function userMessageLooksLikeReservationVerificationIntent(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isOperationalQuoteMessage(t)) return false;
  if (userMessageLooksLikeOperationalCheckinIntent(t)) return true;
  if (/\b(?:fazer|quero|preciso|gostaria\s+de)\s+(?:de\s+)?check[- ]?in\b/i.test(t)) return true;
  if (/\bstatus\s+(?:da\s+)?(?:minha\s+)?reserva\b/i.test(t)) return true;
  if (
    /\b(?:verificar|consultar|confirmar|checar|validar)\b/i.test(t) &&
    /\b(?:minha\s+)?reserva\b/i.test(t)
  ) {
    return true;
  }
  if (/\breserva\b.*\b(?:confirmad[ao]|est[aá]\s+(?:cert[oa]|ok|confirmad[ao]))\b/i.test(t)) {
    return true;
  }
  if (
    /\b(?:est[aá]|tudo)\s+(?:cert[oa]|ok|confirmad[ao])\b.*\b(?:com\s+)?(?:a\s+|minha\s+)?reserva\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(?:minha\s+)?reserva\b.*\b(?:est[aá]|tudo)\s+(?:cert[oa]|ok|confirmad[ao])\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Pedido operacional C2/C3 (check-in / verificar reserva + localizador) —
 * dados vêm da API HTTP, nunca da KB.
 */
export function isOperationalReservationLookupMessage(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isOperationalQuoteMessage(t)) return false;
  if (/data de chegada\s*\(check-in\)|data de partida\s*\(checkout\)/i.test(t)) return false;
  if (!messageContainsReservationLocator(t)) return false;
  return userMessageLooksLikeReservationVerificationIntent(t);
}

/**
 * Cotação / disponibilidade (C6) — não é consulta de KB (C5).
 */
export function isOperationalQuoteMessage(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (
    /\b(cota[cç][aã]o|disponibilidade|reservar|fazer\s+uma\s+reserva)\b/i.test(t) &&
    !/\b(?:localizador|verificar\s+reserva|status\s+(?:da\s+)?reserva)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\d{1,2}[\/.\-]\d{1,2}/.test(t) &&
    /\b(pessoas?|h[oó]spedes?|\d+\s*pessoas?)\b/i.test(t) &&
    !/\b(?:localizador|fazer\s+check[- ]?in|quero\s+check[- ]?in|verificar\s+reserva)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Motivo para omitir RAG proactivo e `buscar_conhecimento` neste turno, ou null se a KB deve correr. */
export function resolveKnowledgeSearchSkip(
  userMessage: string,
  ctx: KnowledgeSearchSkipContext = {},
): KnowledgeSearchSkipReason | null {
  const lastAssistant = ctx.lastAssistantMessage?.trim() ?? "";
  if (
    resolveEstablishmentInConversation({
      userMessage,
      lastAssistantMessage: lastAssistant,
    }) &&
    assistantRequestedEstablishmentForUnitKb(lastAssistant)
  ) {
    return null;
  }

  if (isShortConfirmationOrFlowReply(userMessage)) return "short_confirmation";
  if (isUserDataProvisionMessage(userMessage)) return "data_provision";
  if (
    userMessageLooksLikeCheckinLinkFollowUp(userMessage, lastAssistant) ||
    userMessageLooksLikeReservationVerificationIntent(userMessage) ||
    isOperationalReservationLookupMessage(userMessage) ||
    ctx.reservationLookupScheduled
  ) {
    return "checkin_reservation_turn";
  }

  if (lastAssistant && assistantMessageIsDataCollection(lastAssistant)) {
    if (!userMessageLooksLikeKnowledgeSeekingQuery(userMessage)) return "cadastro_turn";
  }

  const inActiveFlow = Boolean(ctx.flowStep?.trim()) || ctx.hasFlowSlots;
  if (inActiveFlow && !userMessageLooksLikeKnowledgeSeekingQuery(userMessage)) {
    return "active_flow";
  }

  if (ctx.lastToolRoundHadHttpTools && !userMessageLooksLikeKnowledgeSeekingQuery(userMessage)) {
    return "cadastro_turn";
  }

  return null;
}

export function shouldSkipKnowledgeSearchForTurn(
  userMessage: string,
  ctx: KnowledgeSearchSkipContext = {},
): boolean {
  return resolveKnowledgeSearchSkip(userMessage, ctx) !== null;
}

/** Evita poluir a query com histórico em respostas de menu / fluxo (ex.: «1», «sim»). */
export function shouldEnrichKnowledgeSearchQuery(
  userMessage: string,
  history: KnowledgeConversationTurn[] = [],
): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  const lastAssistant =
    [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  if (
    resolveEstablishmentInConversation({ userMessage: t }) &&
    assistantRequestedEstablishmentForUnitKb(lastAssistant)
  ) {
    return true;
  }
  if (shouldSkipKnowledgeSearchForTurn(userMessage, { lastAssistantMessage: lastAssistant })) {
    return false;
  }
  return true;
}

/** Enriquece a query curta/ambígua com contexto da conversa (estabelecimento, tópico). */
export function buildKnowledgeSearchQuery(
  userMessage: string,
  history: KnowledgeConversationTurn[] = [],
): string {
  const user = userMessage.trim();
  if (!user) return user;

  const recent = history.slice(-8);
  const combinedHistory = recent.map((t) => t.content).join("\n");
  const lastAssistant =
    [...recent].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const unitKbEstablishmentReply =
    resolveEstablishmentInConversation({ userMessage: user }) &&
    assistantRequestedEstablishmentForUnitKb(lastAssistant);

  if (!shouldEnrichKnowledgeSearchQuery(user, history) && !unitKbEstablishmentReply) {
    return user.slice(0, 500);
  }

  const parts = [user];
  const establishments = extractEstablishmentFromText(combinedHistory);
  const userEstablishments = extractEstablishmentFromText(user);
  const allEst = [...new Set([...userEstablishments, ...establishments])];

  const topics = detectQueryTopics(user.toLowerCase());
  for (const topic of topics) {
    const syns = TOPIC_SYNONYMS[topic]?.slice(0, 3) ?? [];
    for (const s of syns) {
      if (!user.toLowerCase().includes(s)) parts.push(s);
    }
  }

  if (unitKbEstablishmentReply) {
    if (/\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(combinedHistory)) {
      parts.push("nota fiscal");
    }
    if (/\bcheck[\s-]?out\b/i.test(combinedHistory)) {
      parts.push("procedimento checkout");
    }
  }

  for (const est of allEst.slice(0, 2)) {
    if (!user.toLowerCase().includes(est.toLowerCase())) parts.push(est);
  }

  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join(" ").slice(0, 500);
}

export function extractQueryTopicTerms(query: string): string[] {
  const q = query.trim().toLowerCase();
  const terms = new Set<string>(queryTerms(q));
  for (const topic of detectQueryTopics(q)) {
    for (const s of TOPIC_SYNONYMS[topic] ?? []) {
      if (s.length >= 3) terms.add(s.replace(/\s+/g, " "));
    }
  }
  return [...terms].filter((t) => t.length >= 3);
}

function excerptHasAnswerContent(text: string, minBodyChars = 30): boolean {
  const withoutHeaders = text
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/^---+$/gm, "")
    .trim();
  return withoutHeaders.length >= minBodyChars;
}

/** Corpo com factos respondíveis (listas, pares rótulo:valor, sub-secções) — não só título. */
function sectionBodyHasAnswerFacts(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/^[-*•]\s+\S/m.test(trimmed)) return true;
  if (/^\d+[.)]\s+\S/m.test(trimmed)) return true;
  if (/\*\*[^*]+:\*\*\s*\S/.test(trimmed)) return true;
  if (/^#{3,4}\s+\S/m.test(trimmed) && excerptHasAnswerContent(trimmed, 20)) return true;
  return excerptHasAnswerContent(trimmed, 48);
}

/** Menção tangencial (ex.: «- Quarto» numa lista de campos de NF). */
function isTangentialTopicMention(body: string, syn: string): boolean {
  const synLower = syn.toLowerCase();
  if (synLower !== "quarto" && synLower !== "quartos") return false;
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hits = lines.filter((l) => l.toLowerCase().includes(synLower));
  if (hits.length === 0) return false;
  return hits.every((l) => /^[-*•]\s*(\*\*)?[A-Za-zÀ-ú\s]+(\*\*)?\s*$/.test(l) && l.length < 48);
}

function sectionAnswersTopic(section: MarkdownSection, topics: string[]): boolean {
  const block = `## ${section.title}\n\n${section.body}`.trim();
  if (isKnowledgeOverviewChunk(block)) return false;
  if (!excerptHasAnswerContent(block)) return false;
  if (sectionHeaderMatchesTopics(section.title, topics)) {
    return sectionBodyHasAnswerFacts(section.body);
  }

  const bodyLower = section.body.toLowerCase();
  for (const topic of topics) {
    const syns = TOPIC_SYNONYMS[topic] ?? [topic];
    for (const s of syns) {
      if (!bodyLower.includes(s.toLowerCase())) continue;
      if (isTangentialTopicMention(section.body, s)) continue;
      const idx = bodyLower.indexOf(s.toLowerCase());
      const slice = section.body.slice(Math.max(0, idx - 10), idx + 280);
      if (excerptHasAnswerContent(slice) && !/^[^.\n]{0,120}(?:etc\.?\)?\s*$|, )/i.test(slice.trim())) {
        return true;
      }
    }
  }
  return false;
}

/** True quando excertos contêm factos que respondem à query (não só menção em intro/catálogo). */
export function knowledgeContentCoversQuery(haystack: string, query: string): boolean {
  const raw = haystack.trim();
  if (!raw) return false;

  const stripped = stripProactiveKnowledgeAppendixShell(raw)
    .replace(/^\*\*\d+\.\s+[^*]+\*\*[^\n]*\n/gm, "")
    .trim();
  const body = stripped || raw;
  if (!excerptHasAnswerContent(body)) return false;

  const topics = detectQueryTopics(query.toLowerCase());
  if (topics.length > 0) {
    const sections = parseMarkdownSections(body);
    if (sections.length > 0) {
      return sections.some((sec) => sectionAnswersTopic(sec, topics));
    }
    if (isKnowledgeOverviewChunk(body)) return false;
    return false;
  }

  if (isKnowledgeOverviewChunk(body)) return false;

  const terms = queryTerms(query.toLowerCase()).filter((t) => t.length >= 4);
  if (terms.length === 0) return excerptHasAnswerContent(body);
  const lower = body.toLowerCase();
  const matched = terms.filter((t) => lower.includes(t)).length;
  return matched >= Math.min(terms.length, Math.max(1, Math.ceil(terms.length * 0.5)));
}

export function sectionSignature(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^#{2,3}\s+/.test(l));
  if (line) return line.toLowerCase();
  const docLine = text.split("\n")[0]?.trim().slice(0, 80) ?? "";
  return docLine.toLowerCase() || text.slice(0, 80).toLowerCase();
}

/** Secção relevante para a query (header ou corpo com tópico). */
export function chunkMatchesQueryTopics(text: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const topics = detectQueryTopics(q.toLowerCase());
  if (topics.length === 0) return true;
  if (isKnowledgeOverviewChunk(text)) return false;

  const header = text.match(/^#{2,3}\s+(.+)$/m)?.[1]?.trim() ?? "";
  if (header && sectionHeaderMatchesTopics(header, topics)) return true;

  const sections = parseMarkdownSections(text);
  return sections.some((sec) => sectionAnswersTopic(sec, topics));
}
