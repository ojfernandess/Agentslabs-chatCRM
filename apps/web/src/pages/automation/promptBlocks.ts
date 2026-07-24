export const PROMPT_BLOCK_KEYS = [
  "personality",
  "objective",
  "restrictions",
  "tools",
  "memory",
  "flows",
  "fallback",
  "examples",
] as const;

export type PromptBlockKey = (typeof PROMPT_BLOCK_KEYS)[number];

export type PromptBlocks = Record<PromptBlockKey, string>;

export function emptyPromptBlocks(): PromptBlocks {
  return {
    personality: "",
    objective: "",
    restrictions: "",
    tools: "",
    memory: "",
    flows: "",
    fallback: "",
    examples: "",
  };
}

export function blocksToPromptUserCore(blocks: PromptBlocks): string {
  return PROMPT_BLOCK_KEYS.map((k) => blocks[k]?.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/**
 * Ordem operacional do playbook (prioridade para o LLM).
 * Diferente da ordem visual do editor (`PROMPT_BLOCK_KEYS`).
 */
export const PLAYBOOK_PRIORITY_KEYS: readonly PromptBlockKey[] = [
  "objective",
  "restrictions",
  "flows",
  "tools",
  "fallback",
  "personality",
  "memory",
  "examples",
] as const;

/** Marker idempotente do contrato de playbook. */
export const AGENT_PLAYBOOK_MARKER = "[OpenConduit — playbook do agente]";

/** Títulos canónicos em PT (usados ao reestruturar o markdown). */
export const PROMPT_BLOCK_MARKDOWN_HEADINGS: Record<PromptBlockKey, string> = {
  personality: "Personalidade",
  objective: "Objetivo",
  restrictions: "Restrições",
  tools: "Ferramentas",
  memory: "Memória",
  flows: "Fluxos",
  fallback: "Fallback",
  examples: "Exemplos",
};

/** Heading emitido no playbook (restrições elevadas a MUST FOLLOW). */
export function playbookSectionHeading(key: PromptBlockKey): string {
  if (key === "restrictions") return "Restrições (obrigatório — cumprir sempre)";
  return PROMPT_BLOCK_MARKDOWN_HEADINGS[key];
}

export function buildAgentPlaybookContract(): string {
  return [
    AGENT_PLAYBOOK_MARKER,
    "Cumpra este playbook pela ordem de precedência abaixo. Em caso de conflito:",
    "1) Restrições / regras obrigatórias prevalecem sobre tom e exemplos.",
    "2) Siga os Fluxos passo a passo.",
    "3) Antes de afirmar dados operacionais (reserva, estado, preços internos), consulte a ferramenta indicada no playbook ou nas ferramentas ligadas.",
    "4) Só use Fallback quando a ferramenta ou o fluxo falhar / devolver vazio.",
    "5) Personalidade e Exemplos definem estilo — nunca anulam regras nem saltam passos do fluxo.",
  ].join("\n");
}

/**
 * Monta o núcleo do system prompt a partir dos blocos — hierárquico e priorizado.
 * Preferir isto a `blocksToPromptUserCore` no save / runtime.
 */
export function buildAgentPlaybookFromBlocks(blocks: PromptBlocks): string {
  const sections: string[] = [];
  for (const key of PLAYBOOK_PRIORITY_KEYS) {
    const body = blocks[key]?.trim();
    if (!body) continue;
    sections.push(`## ${playbookSectionHeading(key)}\n${body}`);
  }
  if (sections.length === 0) return "";
  return `${buildAgentPlaybookContract()}\n\n${sections.join("\n\n")}`;
}

/** Envelopa prompt completo com o contrato (idempotente). Não reescreve o texto do utilizador. */
export function buildAgentPlaybookFromFullPrompt(fullPrompt: string): string {
  const body = fullPrompt.trim();
  if (!body) return "";
  if (body.includes(AGENT_PLAYBOOK_MARKER)) return body;
  return `${buildAgentPlaybookContract()}\n\n${body}`;
}

/** Núcleo para gravar / pré-visualizar: blocos → playbook; full → envelope. */
export function buildAgentUserCoreForPersist(input: {
  useFullPrompt: boolean;
  blocks: PromptBlocks;
  fullPrompt: string;
}): string {
  if (input.useFullPrompt) {
    return buildAgentPlaybookFromFullPrompt(input.fullPrompt) || input.fullPrompt.trim();
  }
  return buildAgentPlaybookFromBlocks(input.blocks) || input.fullPrompt.trim();
}

/** Aliases de headings markdown → bloco (PT/EN e variantes comuns). */
const HEADING_ALIASES: Record<PromptBlockKey, string[]> = {
  personality: [
    "personalidade",
    "persona",
    "personality",
    "tom",
    "estilo",
    "voz",
    "role",
    "papel",
  ],
  objective: [
    "objetivo",
    "objectivo",
    "objective",
    "goal",
    "goals",
    "missão",
    "missao",
    "mission",
    "propósito",
    "proposito",
    "purpose",
  ],
  restrictions: [
    "restrições",
    "restricoes",
    "restrictions",
    "constraints",
    "limites",
    "regras",
    "rules",
    "regras operacionais",
    "regras obrigatórias",
    "regras obrigatorias",
    "regra obrigatória",
    "regra obrigatoria",
    "mandatory rules",
    "mandatory rule",
    "must follow",
    "não fazer",
    "nao fazer",
    "guardrails",
  ],
  tools: [
    "ferramentas",
    "tools",
    "funções",
    "funcoes",
    "functions",
    "capabilities",
    "capacidades",
    "integrações",
    "integracoes",
  ],
  memory: [
    "memória",
    "memoria",
    "memory",
    "contexto",
    "context",
    "histórico",
    "historico",
    "history",
    "contexto dinâmico",
    "contexto dinamico",
  ],
  flows: [
    "fluxos",
    "flows",
    "fluxo",
    "flow",
    "passos",
    "etapas",
    "processo",
    "roteiro",
    "playbook",
    "atendimento",
  ],
  fallback: [
    "fallback",
    "falhas",
    "escalonamento",
    "escalation",
    "quando não souber",
    "quando nao souber",
    "quando falhar",
    "plano b",
  ],
  examples: [
    "exemplos",
    "examples",
    "few-shot",
    "fewshot",
    "diálogos",
    "dialogos",
    "dialogue",
    "amostras",
  ],
};

function normalizeHeadingToken(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchPromptBlockKeyFromHeading(heading: string): PromptBlockKey | null {
  const norm = normalizeHeadingToken(heading);
  if (!norm) return null;
  for (const key of PROMPT_BLOCK_KEYS) {
    for (const alias of HEADING_ALIASES[key]) {
      const a = normalizeHeadingToken(alias);
      if (norm === a || norm.startsWith(`${a} `) || norm.endsWith(` ${a}`) || norm.includes(` ${a} `)) {
        return key;
      }
    }
  }
  return null;
}

function stripOcAutoPromptMarkers(text: string): string {
  return text
    .replace(/\n*<!--\s*openconduit:auto-prompt[\s\S]*?<!--\s*\/openconduit:auto-prompt\s*-->\n*/gi, "\n")
    .trim();
}

/**
 * Detecta secções markdown (`#` / `##` / `###` / `**Título**`) e preenche os blocos do editor.
 * Conteúdo sem heading reconhecido vai para `objective` (não se perde texto).
 */
export function parseMarkdownPromptIntoBlocks(rawText: string): PromptBlocks {
  const text = stripOcAutoPromptMarkers(rawText);
  const blocks = emptyPromptBlocks();
  if (!text.trim()) return blocks;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  type Seg = { key: PromptBlockKey | null; lines: string[] };
  const segments: Seg[] = [{ key: null, lines: [] }];

  const headingRe = /^(#{1,3})\s+(.+?)\s*$/;
  const boldHeadingRe = /^\*\*(.+?)\*\*\s*$/;

  for (const line of lines) {
    const h = line.match(headingRe);
    const b = !h ? line.match(boldHeadingRe) : null;
    const title = h ? h[2]!.trim() : b ? b[1]!.trim() : null;
    if (title) {
      const key = matchPromptBlockKeyFromHeading(title);
      if (key) {
        segments.push({ key, lines: [] });
        continue;
      }
    }
    segments[segments.length - 1]!.lines.push(line);
  }

  const preamble = segments[0]?.lines.join("\n").trim() ?? "";
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    if (!seg.key) continue;
    const body = seg.lines.join("\n").trim();
    if (!body) continue;
    blocks[seg.key] = blocks[seg.key] ? `${blocks[seg.key].trim()}\n\n${body}` : body;
  }

  if (preamble) {
    const anyFilled = PROMPT_BLOCK_KEYS.some((k) => blocks[k].trim());
    if (!anyFilled) {
      blocks.objective = preamble;
    } else if (!blocks.personality.trim()) {
      blocks.personality = preamble;
    } else if (!blocks.objective.trim()) {
      blocks.objective = preamble;
    } else {
      blocks.objective = `${preamble}\n\n${blocks.objective}`.trim();
    }
  }

  return blocks;
}

export function countFilledPromptBlocks(blocks: PromptBlocks): number {
  return PROMPT_BLOCK_KEYS.filter((k) => blocks[k]?.trim()).length;
}

/** Markdown estruturado a partir dos blocos (melhora legibilidade; preserva o conteúdo). */
export function blocksToStructuredMarkdown(blocks: PromptBlocks): string {
  const parts: string[] = [];
  for (const key of PROMPT_BLOCK_KEYS) {
    const body = blocks[key]?.trim();
    if (!body) continue;
    parts.push(`## ${PROMPT_BLOCK_MARKDOWN_HEADINGS[key]}\n${body}`);
  }
  return parts.join("\n\n");
}

/**
 * Melhora o desempenho estrutural: detecta markdown, preenche Personalidade/Objetivo/… e
 * devolve blocos + markdown canónico. Não inventa regras novas — só reorganiza o que já existe.
 */
export function improvePromptFromMarkdown(rawText: string): {
  blocks: PromptBlocks;
  structuredMarkdown: string;
  filledCount: number;
} {
  let blocks = parseMarkdownPromptIntoBlocks(rawText);
  if (countFilledPromptBlocks(blocks) <= 1 && rawText.includes("\n---\n")) {
    const chunks = rawText
      .split(/\n---\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (chunks.length > 1) {
      const next = emptyPromptBlocks();
      const keys = [...PROMPT_BLOCK_KEYS];
      chunks.forEach((chunk, i) => {
        const parsed = parseMarkdownPromptIntoBlocks(chunk);
        if (countFilledPromptBlocks(parsed) >= 1) {
          for (const k of PROMPT_BLOCK_KEYS) {
            if (parsed[k].trim()) {
              next[k] = next[k] ? `${next[k]}\n\n${parsed[k]}` : parsed[k];
            }
          }
        } else if (i < keys.length) {
          next[keys[i]!] = chunk;
        } else {
          next.objective = next.objective ? `${next.objective}\n\n${chunk}` : chunk;
        }
      });
      if (countFilledPromptBlocks(next) > countFilledPromptBlocks(blocks)) {
        blocks = next;
      }
    }
  }

  const structuredMarkdown = buildAgentPlaybookFromBlocks(blocks) || blocksToStructuredMarkdown(blocks) || rawText.trim();
  return {
    blocks,
    structuredMarkdown,
    filledCount: countFilledPromptBlocks(blocks),
  };
}

/** Junta texto importado aos blocos atuais (importação «incluir prompt completo»). */
export function mergeImportedPromptIntoBlocks(
  current: PromptBlocks,
  importedRaw: string,
  mode: "replace" | "merge" = "replace",
): PromptBlocks {
  const imported = parseMarkdownPromptIntoBlocks(importedRaw);
  if (mode === "replace" || countFilledPromptBlocks(current) === 0) {
    return countFilledPromptBlocks(imported) > 0
      ? imported
      : { ...emptyPromptBlocks(), objective: importedRaw.trim() };
  }
  const next = { ...current };
  for (const key of PROMPT_BLOCK_KEYS) {
    const add = imported[key]?.trim();
    if (!add) continue;
    next[key] = next[key]?.trim() ? `${next[key].trim()}\n\n${add}` : add;
  }
  return next;
}

export function parsePromptBlocksFromBehavior(
  behavior: unknown,
  fallbackUserCore: string,
): { blocks: PromptBlocks; userCore: string } {
  const empty = emptyPromptBlocks();
  if (!behavior || typeof behavior !== "object") {
    return { blocks: { ...empty, objective: fallbackUserCore }, userCore: fallbackUserCore };
  }
  const pb = (behavior as Record<string, unknown>).promptBuilder;
  if (!pb || typeof pb !== "object") {
    return { blocks: { ...empty, objective: fallbackUserCore }, userCore: fallbackUserCore };
  }
  const rawBlocks = (pb as Record<string, unknown>).blocks;
  if (rawBlocks && typeof rawBlocks === "object") {
    const o = rawBlocks as Record<string, unknown>;
    const blocks = { ...empty };
    for (const k of PROMPT_BLOCK_KEYS) {
      blocks[k] = typeof o[k] === "string" ? o[k] : "";
    }
    const merged = buildAgentPlaybookFromBlocks(blocks);
    return { blocks, userCore: merged || fallbackUserCore };
  }
  return { blocks: { ...empty, objective: fallbackUserCore }, userCore: fallbackUserCore };
}

export function promptBlockLabelKey(key: PromptBlockKey): string {
  return `automationPage.promptBlock_${key}`;
}

export function promptBlockHintKey(key: PromptBlockKey): string {
  return `automationPage.promptBlockHint_${key}`;
}
