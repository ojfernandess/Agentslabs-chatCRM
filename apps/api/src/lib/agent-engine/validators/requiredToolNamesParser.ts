import { parsePromptBlocks, type PromptBlocks } from "../../agentPlaybook.js";
import {
  isContinuationSyntheticMessage,
  parseContinuationSyntheticBody,
} from "../continuation/constants.js";

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
export const GENERIC_TURN_PATTERNS: TurnToolPattern[] = [
  {
    id: "document_id",
    test: (m) => /^\d{11}$/.test(m.trim()),
    playbookHints: /\b(C8|cpf\s*sozinho|11\s*d[ií]gitos|main.?guest|consultar_main_guest)\b/i,
  },
  {
    id: "checkin_or_reservation",
    test: (m) =>
      /check[- ]?in|verificar\s+(?:essa\s+|a\s+)?reserva|consultar\s+(?:essa\s+|a\s+)?reserva|pode\s+consultar|status\s+(da\s+)?reserva/i.test(
        m,
      ) && /[A-Za-z0-9]{5,}/.test(m.replace(/\s+/g, "")),
    // C2/C3 / localizador — não qualquer menção genérica a "reserva"
    playbookHints:
      /\b(C3|C2|check[- ]?in\b.*localizador|localizador.*check[- ]?in|consultar_reserva|verificar\s+reserva)\b/i,
  },
  {
    id: "availability_quote",
    test: (m) =>
      /\b(disponibilidade|cota[cç][aã]o|pre[cç]o|di[aá]ria)\b/i.test(m) &&
      /\d{1,2}[\/.\-]\d{1,2}/.test(m),
    playbookHints: /\b(C5|C6|cota[cç][aã]o|disponibilidade|consultar_disponibilidade)\b/i,
  },
  {
    id: "image_upload",
    test: (m) => /\[Transcri[cç][aã]o de imagem\]/i.test(m),
    playbookHints: /\b(C10|selfie|upload_foto|upload_documento|transcri)\b/i,
  },
  {
    id: "escalation",
    test: (m) =>
      /reclam|irritad|falar com (humano|atendente|pessoa)|quero (um )?humano|p[eé]ssim/i.test(m),
    playbookHints: /\b(C13|reclama[cç][aã]o|call_human|transfer_to_team)\b/i,
  },
];

function isPlausibleToolName(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t || t.length < 3 || t.length > 96) return false;
  if (TOOL_NAME_STOPWORDS.has(t)) return false;
  if (/^oc_tool_[a-f0-9]{32}$/i.test(t)) return true;
  if ((KNOWN_NATIVE_TOOL_NAMES as readonly string[]).includes(t)) return true;
  // HTTP / custom: snake_case ou kebab-case com pelo menos um separador
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/.test(t)) return true;
  return false;
}

function normalizeToolToken(raw: string): string | null {
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
  return findBestTurnMatches(playbookText, pattern, userMessage).map((m) => m.category);
}

type TurnMatch = { category: string; score: number; line: string; tools: string[] };

function scoreTurnLine(
  line: string,
  pattern: TurnToolPattern,
  userMessage: string,
  category: string,
): number {
  let score = 1;
  if (pattern.id === "checkin_or_reservation") {
    const wantsCheckin = /check[- ]?in/i.test(userMessage);
    const wantsVerify =
      /verificar|consultar|status|pode\s+consultar/i.test(userMessage) && !wantsCheckin;
    if (wantsCheckin && (/\bC3\b/i.test(category) || /\bC3\b/i.test(line))) score += 6;
    if (wantsVerify && (/\bC2\b/i.test(category) || /\bC2\b/i.test(line))) score += 6;
    if (wantsCheckin && /check[- ]?in/i.test(line)) score += 4;
    if (wantsVerify && /verificar|consultar/i.test(line)) score += 4;
    if (/localizador/i.test(line)) score += 2;
    if (/consultar_reserva/i.test(line)) score += 3;
    if (
      /\b(C8|C9|C10|S9|S10|selfie|embratur|main_guest)\b/i.test(line) &&
      !/\bC[23]\b/i.test(line)
    ) {
      score -= 8;
    }
    // Linhas C3 que só listam FAQ/KB não são o detector principal
    if (/buscar_conhecimento/i.test(line) && !/consultar_reserva/i.test(line)) score -= 5;
  } else if (pattern.id === "document_id") {
    if (/\bC8\b/i.test(category) || /\bC8\b/i.test(line)) score += 6;
    if (/main_guest|consultar_main_guest|cpf\s*sozinho/i.test(line)) score += 4;
    if (/\b(C3|S10|check_in|selfie)\b/i.test(line) && !/\bC8\b/i.test(line)) score -= 8;
  } else if (pattern.id === "escalation") {
    if (/\bC13\b/i.test(line)) score += 5;
  }
  return score;
}

function findBestTurnMatches(
  playbookText: string,
  pattern: TurnToolPattern,
  userMessage = "",
): TurnMatch[] {
  const scored: TurnMatch[] = [];
  for (const line of playbookText.split(/\n+/)) {
    if (!/\|/.test(line)) continue;
    if (!pattern.playbookHints.test(line)) continue;
    const categoryMatch = line.match(/\|\s*\*{0,2}(C\d+|S\d+|Passo\s*\d+)\*{0,2}\s*\|/i);
    if (!categoryMatch) continue;
    const category = categoryMatch[1]!.replace(/\s+/g, " ").toUpperCase().replace(/^PASSO\s+/i, "PASSO ");
    const tools = extractPositiveToolNamesFromLine(line).filter(
      (n) => pattern.id === "escalation" || !ESCALATION_TOOL_NAMES.has(n),
    );
    if (tools.length === 0) continue;
    const score = scoreTurnLine(line, pattern, userMessage, category);
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
    // Match parcial: playbook `consultar_reserva` vs tool `audaar_consultar_reserva`
    for (const a of avail) {
      if (a.includes(lower) || lower.includes(a)) return true;
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
};

/**
 * Turnos de continuação proactiva: o corpo sintético menciona "check-in"/"reserva"
 * no histórico do passo anterior — NÃO deve disparar padrões C3 (consultar_reserva).
 * Extrai só tools positivamente mandadas no turnHint, excluindo as de "NÃO chame".
 */
export function resolveRequiredToolNamesForContinuationHint(turnHint: string): string[] {
  const hint = turnHint.trim();
  if (!hint) return [];

  const forbidden = new Set<string>();
  for (const m of hint.matchAll(
    /(?:n[aã]o\s+chame|proibid[oa]|must\s+not\s+call|do\s+not\s+call)\s+([^.!?\n]+)/gi,
  )) {
    for (const t of extractToolNamesFromText(m[1] ?? "")) forbidden.add(t);
  }

  const mandated = new Set<string>();
  // "Execute Passo 8: até 4× buscar_conhecimento" / "Chame `foo`" / "use only bar"
  for (const m of hint.matchAll(
    /(?:execute|chame|use|utiliz\w*|invoc\w*|at[eé]\s+\d+\s*[×x])\s+([^.\n]+)/gi,
  )) {
    for (const t of extractToolNamesFromText(m[1] ?? "")) {
      if (!forbidden.has(t) && !ESCALATION_TOOL_NAMES.has(t)) mandated.add(t);
    }
  }
  return [...mandated];
}

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
  const required = new Set<string>();

  const userMessage = (options.userMessage ?? "").trim();
  if (userMessage && isContinuationSyntheticMessage(userMessage)) {
    const parsed = parseContinuationSyntheticBody(userMessage);
    const fromHint = resolveRequiredToolNamesForContinuationHint(parsed?.turnHint ?? userMessage);
    return dedupeRequiredToolAliases(filterAgainstAvailable(fromHint, available));
  }

  if (userMessage) {
    for (const pattern of GENERIC_TURN_PATTERNS) {
      if (!pattern.test(userMessage)) continue;
      const matches = findBestTurnMatches(playbook, pattern, userMessage);
      for (const match of matches) {
        for (const tool of match.tools) {
          required.add(tool);
        }
      }
      // Fallback: 1ª linha do playbook que casa com hints (não todas)
      if (matches.length === 0) {
        for (const line of playbook.split(/\n+/)) {
          if (!pattern.playbookHints.test(line)) continue;
          for (const tool of extractPositiveToolNamesFromLine(line)) {
            if (pattern.id !== "escalation" && ESCALATION_TOOL_NAMES.has(tool)) continue;
            required.add(tool);
          }
          if (required.size > 0) break;
        }
      }
    }
  }

  // Obrigatórios vêm só do padrão de turno. O conjunto estático global do playbook
  // (todas as linhas "Chame `tool`") NÃO é fundido — isso bloqueava o contacto no
  // modo estrito ao exigir selfie+Embratur+check_in+KB no mesmo turno.

  return dedupeRequiredToolAliases(filterAgainstAvailable([...required], available));
}

/**
 * Verifica se uma tool invocadasatisfaz um nome obrigatório (match exacto ou parcial).
 * Cobre `audaar_consultar_main_guest` vs `oc_tool_<uuid>` quando o alias está na preview.
 */
export function toolOutcomeSatisfiesRequired(
  requiredName: string,
  outcomes: Array<{ name: string; preview?: string }>,
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");
  const req = norm(requiredName);
  for (const o of outcomes) {
    const name = norm(o.name ?? "");
    if (name === req) return true;
    if (name.includes(req) || req.includes(name)) return true;
    // Família check_in: audaar_check_in satisfaz s-check-in / check_in (não uploads)
    const reqIsCheckIn =
      /check_?in/.test(req) && !/upload|selfie|documento|document|photo|foto/.test(req);
    const outIsCheckIn =
      /check_?in/.test(name) && !/upload|selfie|documento|document|photo|foto/.test(name);
    if (reqIsCheckIn && outIsCheckIn) return true;
    const preview = (o.preview ?? "").toLowerCase();
    if (preview.includes(`"name":"${req}"`) || preview.includes(requiredName.toLowerCase())) {
      return true;
    }
  }
  return false;
}
