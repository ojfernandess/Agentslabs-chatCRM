import { parsePromptBlocks, type PromptBlocks } from "../../agentPlaybook.js";
import {
  COMPLETION_LINE_RE,
  isLikelyMutableOrCompletionTool,
  isLikelyUploadOrMediaTool,
  shouldExcludeCompletionToolFromRequired,
} from "./playbookRuntimePolicy.js";

/** Nomes nativos estáveis expostos ao LLM (OpenAI function calling). */
export const KNOWN_NATIVE_TOOL_NAMES = [
  "buscar_conhecimento",
  "listar_equipas",
  "transfer_to_team",
  "call_human",
  "set_conversation_status",
  "listar_etiquetas",
  "atribuir_etiquetas",
] as const;

/** Tools de escalonamento — só obrigatórias em turnos de reclamação/humano. */
const ESCALATION_TOOL_NAMES = new Set(["call_human", "transfer_to_team", "listar_equipas"]);

/** Identificador de tool genérico: nativo, HTTP snake_case/kebab ou oc_tool_<hex>. */
const GENERIC_TOOL_NAME_RE = /\b(?:oc_tool_[a-f0-9]{32}|[a-z][a-z0-9_]{2,80}|[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)\b/gi;
const BACKTICK_TOOL_RE = /`([a-z][a-z0-9_-]{2,80}|oc_tool_[a-f0-9]{32})`/gi;

/** Contexto linguístico que indica obrigatoriedade explícita de ferramenta. */
const MANDATORY_CONTEXT_RE =
  /(?:obrigat[oó]ri[oa]s?|sempre\s+(?:use|usa|utiliz\w*|invoc\w*|cham\w*|consult\w*)|deve\s+(?:usar|utilizar|invocar|chamar|consultar)|must\s+(?:use|call|invoke)|always\s+(?:use|call)|antes\s+de\s+responder|nunca\s+responda\s+sem|toolRounds\s*[≥>=]+\s*1|chame\s+`)/i;

/** Tokens demasiado genéricos para serem nomes de tool. */
const TOOL_NAME_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "quando",
  "antes",
  "depois",
  "sempre",
  "nunca",
  "obrigatorio",
  "obrigatória",
  "obrigatorio",
  "obrigatoria",
  "zero",
  "pare",
  "tools",
  "tool",
  "http",
  "api",
  "json",
  "true",
  "false",
  "null",
  "modo",
  "estrito",
  "fluxo",
  "fluxo",
  "turno",
  "prompt",
  "agente",
  "cliente",
  "hospede",
  "hóspede",
  "wifi",
  "wi-fi",
  "e-mail",
  "email",
  "whatsapp",
  "http",
  "https",
]);

export type TurnToolPattern = {
  id: string;
  /** Detecta o tipo de turno a partir da mensagem do utilizador. */
  test: (userMessage: string) => boolean;
  /** Pistas no playbook (coluna Detectar / categoria / tools). */
  playbookHints: RegExp;
};

/**
 * Padrões de turno genéricos — independentes de vertical (hotel, retail, etc.).
 * Cada segmento mapeia tools via tabela do próprio playbook.
 * Hints são deliberadamente estreitos para não marcar todas as categorias do playbook.
 */
/** Mensagem de datas de estadia para cotação (rótulos C6) — não é pedido de check-in C3. */
export function messageLooksLikeQuoteStayDetails(userMessage: string): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (/data de chegada\s*\(check-in\)|data de partida\s*\(checkout\)/i.test(t)) return true;
  if (
    /\d{1,2}[\/.\-]\d{1,2}/.test(t) &&
    /\b(pessoas?|h[oó]spedes?|\d+\s*pessoas?)\b/i.test(t) &&
    !/\b(?:localizador|verificar\s+reserva|fazer\s+check[- ]?in|quero\s+check[- ]?in|status\s+(?:da\s+)?reserva)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

import {
  guestSelectedQuoteOption,
  guestAsksQuoteCategoryInfo,
  messageLooksLikeQuoteCategoryQuestion,
} from "../core/confirmationTurnGuards.js";
import {
  isOperationalQuoteMessage,
  messageContainsReservationLocator,
  userMessageLooksLikeKnowledgeSeekingQuery,
} from "../../knowledgeQueryEnrichment.js";
import {
  messageLooksLikeEscalationTurn,
  shouldRequireCallHumanThisTurn,
} from "../escalation/escalationTurnDetection.js";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  userMessageLooksLikeAmenityItemQuestion,
  unitKbTurnNeedsEstablishmentCollection,
  resolveEstablishmentInConversation,
  shouldRequireUnitKnowledgeLookupThisTurn,
  shouldRequireReservationLookupThisTurn,
  shouldRequireNfGuestLookupWithReservation,
  shouldRequireCallHumanAfterNfConfirmation,
} from "../../unitKnowledgeFlow.js";

export const GENERIC_TURN_PATTERNS: TurnToolPattern[] = [
  {
    id: "document_id",
    test: (m) => /^\d{11}$/.test(m.trim()),
    playbookHints: /\b(C8|cpf\s*sozinho|11\s*d[ií]gitos|main.?guest|consultar_main_guest)\b/i,
  },
  {
    id: "checkin_or_reservation",
    test: (m) => {
      if (messageLooksLikeQuoteStayDetails(m)) return false;
      if (!messageContainsReservationLocator(m)) return false;
      return (
        /check[- ]?in|verificar\s+(?:essa\s+|a\s+)?reserva|consultar\s+(?:essa\s+|a\s+)?reserva|pode\s+consultar|status\s+(?:da\s+)?reserva/i.test(
          m,
        ) &&
        !/\b(cota[cç][aã]o|disponibilidade|pre[cç]o|reservar)\b/i.test(m)
      );
    },
    playbookHints:
      /\b(C3|C2|check[- ]?in\b.*localizador|localizador.*check[- ]?in|consultar_reserva|verificar\s+reserva)\b/i,
  },
  {
    id: "knowledge_unit_fact",
    test: (m) => {
      if (messageLooksLikeQuoteStayDetails(m)) return false;
      if (isOperationalQuoteMessage(m)) return false;
      if (messageLooksLikeEscalationTurn(m)) return false;
      if (userMessageLooksLikeCheckoutProcedureQuestion(m)) return false;
      if (userMessageLooksLikeReceiptOrInvoiceRequest(m)) return false;
      if (userMessageLooksLikeAmenityItemQuestion(m)) return false;
      if (
        messageContainsReservationLocator(m) &&
        /check[- ]?in|verificar\s+reserva|consultar\s+reserva|status\s+(?:da\s+)?reserva/i.test(m)
      ) {
        return false;
      }
      return userMessageLooksLikeKnowledgeSeekingQuery(m);
    },
    playbookHints:
      /\b(C5|Fato da unidade|buscar_conhecimento|FAQ|hor[aá]rio|Wi-Fi|endere[cç]o|categorias|pol[ií]ticas)\b/i,
  },
  {
    id: "quote_request",
    test: (m) =>
      /\b(cota[cç][aã]o|disponibilidade|pre[cç]o|di[aá]ria|reservar|fazer\s+uma\s+reserva)\b/i.test(m) &&
      !/\b(?:localizador|verificar\s+reserva|status\s+(?:da\s+)?reserva|fazer\s+check[- ]?in|quero\s+check[- ]?in)\b/i.test(
        m,
      ),
    playbookHints: /\b(C6|cota[cç][aã]o|disponibilidade|consultar_disponibilidade|GATE C6)\b/i,
  },
  {
    id: "quote_stay_details",
    test: (m) => messageLooksLikeQuoteStayDetails(m),
    playbookHints: /\b(C6|cota[cç][aã]o|disponibilidade|Modelo C6|GATE C6)\b/i,
  },
  {
    id: "availability_quote",
    test: (m) =>
      /\b(disponibilidade|cota[cç][aã]o|pre[cç]o|di[aá]ria)\b/i.test(m) &&
      /\d{1,2}[\/.\-]\d{1,2}/.test(m),
    playbookHints: /\b(C6|cota[cç][aã]o|disponibilidade|consultar_disponibilidade)\b/i,
  },
  {
    id: "image_upload",
    test: (m) => /\[Transcri[cç][aã]o de imagem\]/i.test(m),
    playbookHints: /\b(C10|selfie|upload_foto|upload_documento|transcri)\b/i,
  },
  {
    id: "structured_form_submission",
    test: (m) =>
      /\bficha\b/i.test(m) ||
      (/\b(motivo|transporte|meio\s+de\s+transporte|endere[cç]o|e-mail)\b/i.test(m) &&
        m.split(/\n/).filter((l) => l.trim()).length >= 3) ||
      (/\*\s*\w+\s*:/i.test(m) && m.split(/\n/).filter((l) => l.trim()).length >= 4),
    playbookHints:
      /\b(S\d+|C\d+|Passo\s*\d+|ficha|formul[aá]rio|form\b|dados|bloco\s+de\s+dados|espelho|multi.?campo)\b/i,
  },
  {
    id: "checkout_procedure",
    test: (m) => userMessageLooksLikeCheckoutProcedureQuestion(m),
    playbookHints: /\b(C17|check-out|checkout|procedimento de checkout|procedimento de sa[ií]da)\b/i,
  },
  {
    id: "receipt_invoice",
    test: (m) => userMessageLooksLikeReceiptOrInvoiceRequest(m),
    playbookHints: /\b(C19|nota fiscal|\bnf\b|recibo|comprovante)\b/i,
  },
  {
    id: "amenity_item",
    test: (m) => userMessageLooksLikeAmenityItemQuestion(m),
    playbookHints: /\b(C18|ferro de passar|comodidade|item)\b/i,
  },
  {
    id: "escalation",
    test: (m) => messageLooksLikeEscalationTurn(m),
    playbookHints: /\b(C13|reclama[cç][aã]o|call_human|transfer_to_team)\b/i,
  },
  {
    id: "quote_option_choice",
    test: (m) => {
      const msg = (m ?? "").trim();
      if (!msg) return false;
      if (/^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode|n[aã]o|nao)$/i.test(msg)) return false;
      if (/^\d{11}$/.test(msg)) return false;
      if (messageLooksLikeQuoteCategoryQuestion(msg)) return false;
      if (/^[1-9]$/.test(msg)) return true;
      if (/^(?:op[cç][aã]o\s*)?[1-9]\b/i.test(msg)) return true;
      if (/\b(?:a\s+)?(?:primeir[ao]|segund[ao]|terceir[ao])\b/i.test(msg)) return true;
      if (/\b(prefiro|quero|escolho|vou\s+(?:de|com)|(?:su[ií]te|quarto|apartamento))\b/i.test(msg)) {
        return true;
      }
      return false;
    },
    playbookHints: /\b(C6e|escolha\s+p[oó]s|call_human|GATE C6\s+passo\s+4|C6\s+escolha)\b/i,
  },
  {
    id: "quote_category_info",
    test: (m) => messageLooksLikeQuoteCategoryQuestion(m),
    playbookHints:
      /\b(C6d|d[uú]vida\s+p[oó]s|categoria\s+p[oó]s|buscar_conhecimento|GATE C6\s+passo\s+3a|C6\s+categoria)\b/i,
  },
];

/** Nome de tool real (nativo, snake/kebab com separador, ou oc_tool_<hex>) — não slots/idiomas. */
export function isPlausibleToolName(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t || t.length < 3 || t.length > 96) return false;
  if (TOOL_NAME_STOPWORDS.has(t)) return false;
  // Rótulos de passo do playbook (`s-check-in`, `s1-transfer`, `s10-ficha`) — não são tools.
  if (/^s\d*[-_]/.test(t)) return false;
  if (/^oc_tool_[a-f0-9]{32}$/i.test(t)) return true;
  if ((KNOWN_NATIVE_TOOL_NAMES as readonly string[]).includes(t)) return true;
  // HTTP / custom: snake_case ou kebab-case com pelo menos um separador
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/.test(t)) return true;
  return false;
}

export function normalizeToolToken(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isPlausibleToolName(t)) return null;
  if (/^oc_tool_[a-f0-9]{32}$/i.test(t)) return t.toLowerCase();
  return t.toLowerCase();
}

/** Extrai nomes de tools plausíveis de texto livre / tabelas markdown. */
export function extractToolNamesFromText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(GENERIC_TOOL_NAME_RE)) {
    const norm = normalizeToolToken(match[0]);
    if (norm) found.add(norm);
  }
  for (const match of text.matchAll(BACKTICK_TOOL_RE)) {
    const norm = normalizeToolToken(match[1] ?? "");
    if (norm) found.add(norm);
  }
  return [...found];
}

/** Extrai ferramentas marcadas como obrigatórias num bloco de texto do playbook. */
export function parseRequiredToolNamesFromText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const required = new Set<string>();
  const segments = trimmed.split(/\n+|(?<=[.!?])\s+/);

  for (const segment of segments) {
    if (!MANDATORY_CONTEXT_RE.test(segment)) continue;
    for (const name of extractToolNamesFromText(segment)) {
      required.add(name);
    }
  }

  return [...required];
}

/**
 * Parse tabelas markdown do playbook: categoria → tools mencionadas na mesma linha / bloco.
 * Formato típico: `| C8 | … | … | lookup |` ou `| **C8** | \`tool_name\` |`.
 */
export function parseCategoryToolMapFromPlaybook(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!text.trim()) return map;

  for (const line of text.split(/\n+/)) {
    if (!/\|/.test(line)) continue;
    const categoryMatch = line.match(/\|\s*\*{0,2}(C\d+|S\d+|Passo\s*\d+)\*{0,2}\s*\|/i);
    if (!categoryMatch) continue;
    const category = categoryMatch[1]!.replace(/\s+/g, " ").toUpperCase().replace(/^PASSO\s+/i, "PASSO ");
    const tools = extractToolNamesFromText(line).filter((n) => !ESCALATION_TOOL_NAMES.has(n) || /C13|reclama/i.test(line));
    if (tools.length === 0) continue;
    const prev = map.get(category) ?? [];
    map.set(category, [...new Set([...prev, ...tools])]);
  }

  // Linhas tipo `| **C8** | \`audaar_consultar_main_guest\` |`
  for (const line of text.split(/\n+/)) {
    const m = line.match(/\|\s*\*{0,2}(C\d+|S\d+)\*{0,2}\s*\|\s*`([^`]+)`/i);
    if (!m) continue;
    const category = m[1]!.toUpperCase();
    const tool = normalizeToolToken(m[2] ?? "");
    if (!tool) continue;
    const prev = map.get(category) ?? [];
    map.set(category, [...new Set([...prev, tool])]);
  }

  return map;
}

/** Encontra a melhor categoria do playbook para o padrão do turno (não todas as menções). */
export function findCategoriesForTurnPattern(
  playbookText: string,
  pattern: TurnToolPattern,
  userMessage = "",
): string[] {
  const completionHints = completionHintsFromPlaybook(playbookText);
  return findBestTurnMatches(playbookText, pattern, userMessage, completionHints).map((m) => m.category);
}

type TurnMatch = { category: string; score: number; line: string; tools: string[] };

function completionHintsFromPlaybook(text: string): string[] {
  const hints = new Set<string>();
  for (const line of text.split(/\n+/)) {
    if (/proibid/i.test(line) && !/\bS\d+\b|conclu[ií]d|passo\s*\d+/i.test(line)) continue;
    if (!COMPLETION_LINE_RE.test(line)) continue;
    for (const t of extractToolNamesFromText(line)) {
      if (isLikelyMutableOrCompletionTool(t)) hints.add(t);
    }
  }
  return [...hints];
}

function scoreTurnLine(
  line: string,
  pattern: TurnToolPattern,
  userMessage: string,
  category: string,
  completionHints: string[],
): number {
  let score = 1;
  const lineTools = extractToolNamesFromText(line);
  const hasLookupTool = lineTools.some((t) =>
    /(?:^|_)(?:consult|lookup|search|find|get|fetch|read)(?:_|$)/i.test(t),
  );
  const completionOrUploadOnly =
    lineTools.length > 0 &&
    lineTools.every(
      (t) => isLikelyMutableOrCompletionTool(t, completionHints) || isLikelyUploadOrMediaTool(t),
    );

  if (pattern.id === "checkin_or_reservation") {
    const wantsCheckin = /check[- ]?in/i.test(userMessage);
    const wantsVerify =
      /verificar|consultar|status|pode\s+consultar/i.test(userMessage) && !wantsCheckin;
    if (wantsCheckin && (/\bC3\b/i.test(category) || /\bC3\b/i.test(line))) score += 6;
    if (wantsVerify && (/\bC2\b/i.test(category) || /\bC2\b/i.test(line))) score += 6;
    if (wantsCheckin && /check[- ]?in/i.test(line)) score += 4;
    if (wantsVerify && /verificar|consultar/i.test(line)) score += 4;
    if (/localizador|reference|booking|reserva/i.test(line)) score += 2;
    if (/consultar_reserva|lookup|search/i.test(line)) score += 3;
    if (!hasLookupTool && completionOrUploadOnly) score -= 8;
    if (/buscar_conhecimento/i.test(line) && !/consult|lookup|reserva/i.test(line)) score -= 5;
  } else if (pattern.id === "document_id") {
    if (/\bC8\b/i.test(category) || /\bC8\b/i.test(line)) score += 6;
    if (/main_guest|consultar_main_guest|cpf\s*sozinho|document|cliente/i.test(line)) score += 4;
    if (!hasLookupTool && completionOrUploadOnly) score -= 8;
  } else if (pattern.id === "escalation") {
    if (/\bC13\b/i.test(line)) score += 5;
  } else if (pattern.id === "quote_option_choice") {
    if (/\bC6e\b/i.test(category) || /\bC6e\b/i.test(line)) score += 8;
    if (/escolha|call_human|passo\s+4/i.test(line)) score += 4;
    if (/C6\s+escolha/i.test(line)) score += 4;
  } else if (pattern.id === "quote_category_info") {
    if (/\bC6d\b/i.test(category) || /\bC6d\b/i.test(line)) score += 8;
    if (/buscar_conhecimento|categoria|passo\s+3a/i.test(line)) score += 4;
  } else if (pattern.id === "knowledge_unit_fact") {
    if (/\bC5\b/i.test(category) || /\bC5\b/i.test(line)) score += 8;
    if (/buscar_conhecimento|FAQ|hor[aá]rio|Wi-Fi|endere[cç]o|categorias|pol[ií]ticas/i.test(line)) {
      score += 4;
    }
    if (/consultar_reserva/i.test(line)) score -= 10;
  } else if (
    pattern.id === "quote_request" ||
    pattern.id === "quote_stay_details" ||
    pattern.id === "availability_quote"
  ) {
    const isConfirmation = /^(sim|ok|okay|certo|confirmo|yes|pode)$/i.test(userMessage.trim());
    if (/\bC6c\b/i.test(category) || /\bC6c\b/i.test(line)) {
      score += isConfirmation ? 8 : -12;
    }
    if (/\bC6\b/i.test(category) && !/\bC6c\b/i.test(category)) score += 6;
    if (/\bZERO\b/i.test(line) || /Modelo C6 (Abertura|Confirm)/i.test(line)) score += 8;
    if (/GATE C6 coleta|coleta|confirma/i.test(line) && !/consultar_disponibilidade/i.test(line)) {
      score += 4;
    }
    if (/consultar_disponibilidade|disponibilidade|cota/i.test(line)) {
      score += isConfirmation ? 4 : -6;
    }
    if (/consultar_reserva/i.test(line) && !/C2|C3/i.test(category)) score -= 10;
    if (/buscar_conhecimento/i.test(line)) score -= 6;
  } else if (pattern.id === "structured_form_submission") {
    if (/\b(S\d+|C\d+|Passo\s*\d+)\b/i.test(category) || /\b(S\d+|C\d+|Passo\s*\d+)\b/i.test(line))
      score += 5;
    if (/ficha|formul[aá]rio|espelho|bloco\s+de\s+dados|multi.?campo/i.test(line)) score += 4;
    for (const t of lineTools) {
      if (isLikelyMutableOrCompletionTool(t, completionHints)) score -= 10;
      if (isLikelyUploadOrMediaTool(t) && !/ficha|formul[aá]rio|espelho/i.test(line)) score -= 4;
    }
    if (/submit|finaliz|conclu|save|gravar/i.test(line) && !lineTools.some((t) => isLikelyMutableOrCompletionTool(t, completionHints))) {
      score += 3;
    }
  }
  return score;
}

function findBestTurnMatches(
  playbookText: string,
  pattern: TurnToolPattern,
  userMessage = "",
  completionHints: string[] = [],
): TurnMatch[] {
  const scored: TurnMatch[] = [];
  for (const line of playbookText.split(/\n+/)) {
    if (!/\|/.test(line)) continue;
    if (!pattern.playbookHints.test(line)) continue;
    const categoryMatch = line.match(/^\|\s*\*{0,2}([^|]+?)\*{0,2}\s*\|/);
    if (!categoryMatch) continue;
    const category = categoryMatch[1]!.replace(/\s+/g, " ").trim().toUpperCase();
    const tools = extractPositiveToolNamesFromLine(line).filter(
      (n) =>
        pattern.id === "escalation" ||
        pattern.id === "quote_option_choice" ||
        !ESCALATION_TOOL_NAMES.has(n),
    );
    if (tools.length === 0) continue;
    const score = scoreTurnLine(line, pattern, userMessage, category, completionHints);
    scored.push({ category, score, line, tools });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!.score;
  return scored.filter((s) => s.score === best && s.score > 0);
}

/**
 * Extrai tools "positivas" de uma linha de tabela (ignora menções após PROIBIDO/never).
 * Evita exigir `buscar_conhecimento` quando a linha diz PROIBIDO buscar_conhecimento.
 */
export function extractPositiveToolNamesFromLine(line: string): string[] {
  const cleaned = line
    .replace(/\*{0,2}proibid[oa]\*{0,2}[^.|]*?(?=·|\||$)/gi, " ")
    .replace(/\b(?:never\s+use|do\s+not\s+(?:use|call)|n[aã]o\s+(?:use|chame|invogue))\b[^.|]*?(?=·|\||$)/gi, " ");
  return extractToolNamesFromText(cleaned);
}

/** Remove aliases curtos quando já existe o nome completo (ex.: consultar_reserva ⊂ audaar_…). */
export function dedupeRequiredToolAliases(names: string[]): string[] {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const name of sorted) {
    const lower = name.toLowerCase().replace(/-/g, "_");
    const covered = kept.some((k) => {
      const kl = k.toLowerCase().replace(/-/g, "_");
      return kl === lower || kl.includes(lower) || lower.includes(kl);
    });
    if (!covered) kept.push(name);
  }
  return kept;
}

function readPromptBlocksFromBehavior(behaviorConfig: Record<string, unknown>): PromptBlocks {
  const pb = behaviorConfig.promptBuilder;
  if (!pb || typeof pb !== "object") return parsePromptBlocks(null);
  const blocksRaw = (pb as Record<string, unknown>).blocks;
  return parsePromptBlocks(blocksRaw);
}

/** Texto do playbook a partir de behaviorConfig (userCore ou blocos). */
export function playbookTextFromBehavior(behaviorConfig: Record<string, unknown>): string {
  const pb = behaviorConfig.promptBuilder;
  if (pb && typeof pb === "object") {
    const raw = pb as Record<string, unknown>;
    if (raw.useFullPrompt === true && typeof raw.userCore === "string" && raw.userCore.trim()) {
      return raw.userCore.trim();
    }
  }
  const blocks = readPromptBlocksFromBehavior(behaviorConfig);
  return [blocks.restrictions, blocks.tools, blocks.flows, blocks.objective, blocks.examples]
    .filter(Boolean)
    .join("\n\n");
}

function listAvailableToolNames(behaviorConfig: Record<string, unknown>): string[] {
  const fromConfig: string[] = [];
  const candidates = [
    behaviorConfig.availableToolNames,
    behaviorConfig.linkedToolNames,
    behaviorConfig.toolNames,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === "string") {
          const n = normalizeToolToken(item);
          if (n) fromConfig.push(n);
        }
      }
    }
  }
  // Fallback: todos os nomes de tool mencionados no playbook (universo candidato)
  const fromPlaybook = extractToolNamesFromText(playbookTextFromBehavior(behaviorConfig));
  return [...new Set([...fromConfig, ...fromPlaybook, ...KNOWN_NATIVE_TOOL_NAMES])];
}

function filterAgainstAvailable(required: string[], available: string[]): string[] {
  if (available.length === 0) return required;
  const avail = new Set(available.map((a) => a.toLowerCase()));
  return required.filter((r) => {
    const lower = r.toLowerCase();
    if (avail.has(lower)) return true;
    const rn = lower.replace(/-/g, "_");
    // Alias por sufixo (consultar_reserva ⊂ audaar_consultar_reserva).
    // Exige ≥8 chars e fronteira — evita rótulos curtos / `s-check-in`.
    if (rn.length < 8) return false;
    for (const a of avail) {
      const an = a.replace(/-/g, "_");
      if (an === rn) return true;
      if (an.endsWith(`_${rn}`) || (an.endsWith(rn) && an.length > rn.length)) return true;
      if (rn.endsWith(`_${an}`) || (rn.endsWith(an) && rn.length > an.length && an.length >= 8))
        return true;
    }
    return false;
  });
}

/**
 * Resolve ferramentas obrigatórias a partir de `behaviorConfig.promptBuilder.blocks`
 * (restrições, ferramentas, fluxos) quando há linguagem explícita de obrigatoriedade.
 * Escalonamento (call_human / transfer) é excluído do conjunto estático global.
 */
export function resolveRequiredToolNamesFromBehavior(
  behaviorConfig: Record<string, unknown> | null | undefined,
): string[] {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return [];

  const blocks = readPromptBlocksFromBehavior(behaviorConfig);
  const merged = new Set<string>();

  for (const block of [blocks.restrictions, blocks.tools, blocks.flows]) {
    for (const name of parseRequiredToolNamesFromText(block)) {
      if (ESCALATION_TOOL_NAMES.has(name)) continue;
      merged.add(name);
    }
  }

  return filterAgainstAvailable([...merged], listAvailableToolNames(behaviorConfig));
}

export type ResolveRequiredToolsOptions = {
  userMessage?: string;
  availableToolNames?: string[];
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean>;
};

/**
 * Resolve tools obrigatórias para o turno actual (genérico, multi-segmento).
 * Preferência: tools da(s) melhor(es) categoria(s) do padrão do turno.
 * Não funde o conjunto estático global do playbook quando o turno já tem categoria
 * (evita exigir selfie/Embratur/check_in num C3).
 */
export function resolveRequiredToolNamesForTurn(
  behaviorConfig: Record<string, unknown> | null | undefined,
  options: ResolveRequiredToolsOptions = {},
): string[] {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return [];

  const available = [
    ...listAvailableToolNames(behaviorConfig),
    ...(options.availableToolNames ?? []).map((n) => normalizeToolToken(n)).filter(Boolean) as string[],
  ];
  const playbook = playbookTextFromBehavior(behaviorConfig);
  const completionHints = completionHintsFromPlaybook(playbook);
  const required = new Set<string>();

  const userMessage = (options.userMessage ?? "").trim();
  const unitCtx = {
    userMessage,
    lastAssistantMessage: options.lastAssistantMessage,
    flowSlots: options.flowSlots,
  };

  if (unitKbTurnNeedsEstablishmentCollection(unitCtx)) {
    return [];
  }

  if (
    shouldRequireCallHumanAfterNfConfirmation({
      userMessage,
      lastAssistantMessage: options.lastAssistantMessage,
    })
  ) {
    return dedupeRequiredToolAliases(filterAgainstAvailable(["call_human"], available));
  }

  if (shouldRequireReservationLookupThisTurn(unitCtx)) {
    const reservationTool = available.find((t) => /consultar_reserva/i.test(t));
    const tools = reservationTool ? [reservationTool] : ["audaar_consultar_reserva"];
    if (shouldRequireNfGuestLookupWithReservation(unitCtx)) {
      const guestTool = available.find((t) => /consultar_main_guest|main_guest/i.test(t));
      if (guestTool) tools.push(guestTool);
      else tools.push("audaar_consultar_main_guest");
    }
    return dedupeRequiredToolAliases(filterAgainstAvailable(tools, available));
  }

  if (shouldRequireUnitKnowledgeLookupThisTurn(unitCtx)) {
    return dedupeRequiredToolAliases(
      filterAgainstAvailable(["buscar_conhecimento"], available),
    );
  }

  const quoteConfirmationTurn = /^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode)$/i.test(
    userMessage,
  );
  if (userMessage) {
    for (const pattern of GENERIC_TURN_PATTERNS) {
      if (!pattern.test(userMessage)) continue;
      if (
        pattern.id === "quote_option_choice" &&
        !guestSelectedQuoteOption({
          userMessage,
          lastAssistantMessage: options.lastAssistantMessage,
          flowSlots: options.flowSlots,
        })
      ) {
        continue;
      }
      if (
        pattern.id === "quote_category_info" &&
        !guestAsksQuoteCategoryInfo({
          userMessage,
          lastAssistantMessage: options.lastAssistantMessage,
          flowSlots: options.flowSlots,
        })
      ) {
        continue;
      }
      // C6 coleta/confirmação = ZERO tools; C6c (disponibilidade) só via turnPolicy no «sim» pós Confirm.
      if (
        (pattern.id === "quote_request" ||
          pattern.id === "quote_stay_details" ||
          pattern.id === "availability_quote") &&
        !quoteConfirmationTurn
      ) {
        continue;
      }
      const matches = findBestTurnMatches(playbook, pattern, userMessage, completionHints);
      for (const match of matches) {
        for (const tool of match.tools) {
          if (shouldExcludeCompletionToolFromRequired(pattern.id, tool, completionHints)) continue;
          required.add(tool);
        }
      }
      if (matches.length === 0) {
        for (const line of playbook.split(/\n+/)) {
          if (!pattern.playbookHints.test(line)) continue;
          for (const tool of extractPositiveToolNamesFromLine(line)) {
            if (
              pattern.id !== "escalation" &&
              pattern.id !== "quote_option_choice" &&
              ESCALATION_TOOL_NAMES.has(tool)
            ) {
              continue;
            }
            if (shouldExcludeCompletionToolFromRequired(pattern.id, tool, completionHints)) continue;
            required.add(tool);
          }
          if (required.size > 0) break;
        }
      }
    }
  }

  if (
    shouldRequireCallHumanThisTurn({
      userMessage,
      lastAssistantMessage: options.lastAssistantMessage,
    })
  ) {
    for (const line of playbook.split(/\n+/)) {
      if (!/\b(C13|reclama[cç][aã]o|call_human)\b/i.test(line)) continue;
      for (const tool of extractPositiveToolNamesFromLine(line)) {
        if (/^call_human$/i.test(tool)) required.add(tool);
      }
      if ([...required].some((t) => /^call_human$/i.test(t))) break;
    }
    return dedupeRequiredToolAliases(
      filterAgainstAvailable(["call_human"], available),
    );
  }

  for (const tool of [...required]) {
    if (ESCALATION_TOOL_NAMES.has(tool)) required.delete(tool);
  }

  // Obrigatórios vêm só do padrão de turno. O conjunto estático global do playbook
  // (todas as linhas "Chame `tool`") NÃO é fundido — isso bloqueava o contacto no
  // modo estrito ao exigir selfie+Embratur+check_in+KB no mesmo turno.

  return dedupeRequiredToolAliases(filterAgainstAvailable([...required], available));
}

/**
 * Verifica se uma tool invocada satisfaz um nome obrigatório (match exacto ou parcial).
 * Cobre `audaar_consultar_main_guest` vs alias curto `consultar_main_guest`.
 * Outcomes com `ok: false` NUNCA satisfazem o contrato (evita marcar falhas HTTP como done).
 * Rótulos `s-*` do playbook nunca satisfazem (não são tools reais).
 */
export function toolOutcomeSatisfiesRequired(
  requiredName: string,
  outcomes: Array<{ name: string; preview?: string; ok?: boolean }>,
): boolean {
  const req = requiredName.toLowerCase();
  if (/^s\d*[-_]/.test(req)) return false;
  const rr = req.replace(/-/g, "_");
  for (const o of outcomes) {
    if (o.ok === false) continue;
    const name = (o.name ?? "").toLowerCase();
    const nn = name.replace(/-/g, "_");
    if (nn === rr) return true;
    if (rr.length >= 8 && (nn.endsWith(`_${rr}`) || (nn.endsWith(rr) && nn.length > rr.length)))
      return true;
    if (nn.length >= 8 && (rr.endsWith(`_${nn}`) || (rr.endsWith(nn) && rr.length > nn.length)))
      return true;
    if (rr.length >= 12) {
      const preview = (o.preview ?? "").toLowerCase();
      if (preview.includes(`"name":"${req}"`) || preview.includes(req)) return true;
    }
  }
  return false;
}
