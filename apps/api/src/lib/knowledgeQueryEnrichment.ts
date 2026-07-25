import { extractQuerySegmentTokens, queryTerms } from "./knowledgeSearchRanking.js";

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

/** Enriquece a query curta/ambígua com contexto da conversa (estabelecimento, tópico). */
export function buildKnowledgeSearchQuery(
  userMessage: string,
  history: KnowledgeConversationTurn[] = [],
): string {
  const user = userMessage.trim();
  if (!user) return user;

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

/** Verifica se o texto recuperado cobre o tópico perguntado (evita falso positivo de «excertos úteis»). */
export function knowledgeContentCoversQuery(haystack: string, query: string): boolean {
  const lower = haystack.toLowerCase();
  if (!lower.trim()) return false;

  const topics = detectQueryTopics(query.toLowerCase());
  if (topics.length > 0) {
    return topics.some((topic) => {
      const syns = TOPIC_SYNONYMS[topic] ?? [topic];
      if (syns.some((s) => lower.includes(s))) return true;
      const header = topic.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      if (lower.includes(`## ${header}`) || lower.includes(`### ${header}`)) return true;
      return false;
    });
  }

  const terms = queryTerms(query.toLowerCase()).filter((t) => t.length >= 4);
  if (terms.length === 0) return lower.length >= 80;
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
