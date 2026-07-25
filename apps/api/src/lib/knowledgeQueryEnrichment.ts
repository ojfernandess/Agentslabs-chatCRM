import { extractQuerySegmentTokens, queryTerms } from "./knowledgeSearchRanking.js";
import { stripProactiveKnowledgeAppendixShell } from "./kbAppendix.js";

export type KnowledgeConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Tópicos factuais comuns em bases de conhecimento (sinónimos PT/EN). */
const TOPIC_SYNONYMS: Record<string, string[]> = {
  wifi: ["wifi", "wi-fi", "wi fi", "ssid", "rede wi", "internet", "wireless", "senha da rede", "nome da rede"],
  estacionamento: ["estacionamento", "parking", "vaga", "garagem", "estacionar"],
  cancelamento: ["cancelamento", "cancelar", "reembolso", "reembolsável"],
  checkin: ["check-in", "check in", "checkin", "checkout", "check-out", "check out", "entrada", "saída"],
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

/** Evita poluir a query com histórico em respostas de menu / fluxo (ex.: «1», «sim»). */
export function shouldEnrichKnowledgeSearchQuery(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (/^\d{1,2}$/.test(t)) return false;
  if (t.length <= 3 && !/\?/.test(t)) return false;
  if (
    t.length <= 48 &&
    /^(sim|n[aã]o|ok|okay|certo|correto|yes|no)\b/i.test(t)
  ) {
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
  if (!shouldEnrichKnowledgeSearchQuery(user)) return user.slice(0, 500);

  const parts = [user];
  const recent = history.slice(-8);
  const combinedHistory = recent.map((t) => t.content).join("\n");
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
