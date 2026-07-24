import type { MemoryCategory } from "./memoryEngineTypes.js";
import { isCasualText, isTemporaryText } from "./MemoryValidator.js";

type ExtractedCandidate = {
  text: string;
  category: MemoryCategory;
  confidence: number;
};

const CATEGORY_RULES: Array<{
  category: MemoryCategory;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    category: "preferences",
    confidence: 0.85,
    patterns: [
      /prefere/i,
      /preferência/i,
      /preferencia/i,
      /gosta de/i,
      /não gosta/i,
      /nao gosta/i,
      /sempre pede/i,
      /costuma/i,
      /fala (português|espanhol|inglês|ingles|francês|frances)/i,
      /whatsapp/i,
      /email/i,
      /alergia/i,
      /cachorro|gato|pet/i,
      /quarto térreo|quarto terreo/i,
    ],
  },
  {
    category: "commercial_history",
    confidence: 0.8,
    patterns: [
      /cliente vip/i,
      /comprou/i,
      /contrato/i,
      /orçamento/i,
      /orcamento/i,
      /negocia/i,
      /fechou/i,
      /histórico comercial/i,
      /historico comercial/i,
    ],
  },
  {
    category: "hotel",
    confidence: 0.82,
    patterns: [/hotel/i, /hospedagem/i, /check-in|check in/i, /check-out|check out/i],
  },
  {
    category: "reservation",
    confidence: 0.85,
    patterns: [/reserva/i, /localizador/i, /booking/i, /confirmação/i, /confirmacao/i],
  },
  {
    category: "financial",
    confidence: 0.78,
    patterns: [/pagamento/i, /fatura/i, /boleto|pix|cartão|cartao/i, /parcel/i],
  },
  {
    category: "technical_data",
    confidence: 0.75,
    patterns: [/versão/i, /versao/i, /integração/i, /integracao/i, /api key/i, /token/i, /erro/i, /bug/i],
  },
  {
    category: "products",
    confidence: 0.76,
    patterns: [/produto/i, /plano/i, /pacote/i, /serviço/i, /servico/i],
  },
  {
    category: "profile",
    confidence: 0.7,
    patterns: [/empresa/i, /cargo/i, /profissão/i, /profissao/i, /aniversário|aniversario/i],
  },
  {
    category: "support",
    confidence: 0.72,
    patterns: [/suporte/i, /ticket/i, /reclama/i, /problema/i, /chamado/i],
  },
];

function detectCategory(text: string): { category: MemoryCategory; confidence: number } {
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return { category: rule.category, confidence: rule.confidence };
    }
  }
  return { category: "preferences", confidence: 0.65 };
}

function extractLocatorMemory(userMessage: string, combined: string): ExtractedCandidate | null {
  const locator = userMessage.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{4,12}\b/i)?.[0];
  if (locator && /localizador|reserva|código|codigo/i.test(combined)) {
    return {
      text: `Localizador/reserva informado: ${locator.toUpperCase()}`,
      category: "reservation",
      confidence: 0.9,
    };
  }
  return null;
}

/** Extrai candidatos a memória persistente a partir de um turno. */
export function extractMemoryCandidates(
  userMessage: string,
  assistantMessage: string,
): ExtractedCandidate[] {
  const user = userMessage.trim();
  const assistant = assistantMessage.trim();
  const combined = `${user}\n${assistant}`.trim();
  if (!combined || isCasualText(user) || isTemporaryText(combined)) return [];

  const out: ExtractedCandidate[] = [];
  const locator = extractLocatorMemory(user, combined);
  if (locator) out.push(locator);

  const sentences = combined
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && !isCasualText(s) && !isTemporaryText(s));

  for (const sentence of sentences.slice(0, 4)) {
    const { category, confidence } = detectCategory(sentence);
    out.push({ text: sentence.slice(0, 500), category, confidence });
  }

  const dedup = new Map<string, ExtractedCandidate>();
  for (const row of out) {
    const key = row.text.toLowerCase();
    if (!dedup.has(key)) dedup.set(key, row);
  }
  return [...dedup.values()];
}
