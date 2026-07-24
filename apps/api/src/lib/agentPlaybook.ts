/**
 * Playbook estruturado do agente (espelho de apps/web/.../promptBlocks.ts).
 * Remonta o núcleo do system prompt a partir de promptBuilder.blocks sem alterar o auto-prompt.
 */
import {
  mergeSystemWithAutoBlock,
  OC_AUTO_PROMPT_START,
  splitStoredSystemInstructions,
} from "./agentPromptSync.js";

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

export const AGENT_PLAYBOOK_MARKER = "[OpenConduit — playbook do agente]";

const PROMPT_BLOCK_MARKDOWN_HEADINGS: Record<PromptBlockKey, string> = {
  personality: "Personalidade",
  objective: "Objetivo",
  restrictions: "Restrições",
  tools: "Ferramentas",
  memory: "Memória",
  flows: "Fluxos",
  fallback: "Fallback",
  examples: "Exemplos",
};

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

export function parsePromptBlocks(raw: unknown): PromptBlocks {
  const blocks = emptyPromptBlocks();
  if (!raw || typeof raw !== "object") return blocks;
  const o = raw as Record<string, unknown>;
  for (const k of PROMPT_BLOCK_KEYS) {
    blocks[k] = typeof o[k] === "string" ? o[k] : "";
  }
  return blocks;
}

export function countFilledPromptBlocks(blocks: PromptBlocks): number {
  return PROMPT_BLOCK_KEYS.filter((k) => blocks[k]?.trim()).length;
}

function playbookSectionHeading(key: PromptBlockKey): string {
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

export function buildAgentPlaybookFromFullPrompt(fullPrompt: string): string {
  const body = fullPrompt.trim();
  if (!body) return "";
  if (body.includes(AGENT_PLAYBOOK_MARKER)) return body;
  return `${buildAgentPlaybookContract()}\n\n${body}`;
}

function extractAutoPromptInner(full: string): string | null {
  const start = full.indexOf(OC_AUTO_PROMPT_START);
  if (start === -1) {
    // Fallback: markers may already be trimmed / alternate spacing
    const looseStart = full.search(/<!--\s*openconduit:auto-prompt/i);
    if (looseStart === -1) return null;
    const after = full.indexOf("-->", looseStart);
    if (after === -1) return null;
    const innerStart = after + 3;
    const end = full.search(/<!--\s*\/openconduit:auto-prompt\s*-->/i);
    if (end === -1 || end < innerStart) return null;
    return full.slice(innerStart, end).trim();
  }
  const innerStart = start + OC_AUTO_PROMPT_START.length;
  const endMarker = "\n<!-- /openconduit:auto-prompt -->";
  const end = full.indexOf(endMarker, innerStart);
  if (end === -1) {
    const alt = full.search(/<!--\s*\/openconduit:auto-prompt\s*-->/i);
    if (alt === -1 || alt < innerStart) return null;
    return full.slice(innerStart, alt).trim();
  }
  return full.slice(innerStart, end).trim();
}

/**
 * Remonta o playbook no system prompt a partir de `promptBuilder`, preservando o auto-prompt.
 * Idempotente; não altera tools ligadas nem conteúdo do bloco automático.
 */
export function applyAgentPlaybookToSystemInstructions(
  systemInstructions: string,
  promptBuilder: Record<string, unknown> | null | undefined,
): string {
  if (!systemInstructions.trim()) return systemInstructions;
  const pb = promptBuilder && typeof promptBuilder === "object" ? promptBuilder : null;
  const useFullPrompt = pb?.useFullPrompt === true;
  const blocks = parsePromptBlocks(pb?.blocks);
  const filled = countFilledPromptBlocks(blocks);
  const { userCore } = splitStoredSystemInstructions(systemInstructions);
  const autoInner = extractAutoPromptInner(systemInstructions);

  let nextCore: string;
  if (!useFullPrompt && filled > 0) {
    nextCore = buildAgentPlaybookFromBlocks(blocks);
  } else {
    const source =
      (typeof pb?.userCore === "string" && pb.userCore.trim()) || userCore.trim() || "";
    nextCore = buildAgentPlaybookFromFullPrompt(source);
  }

  if (!nextCore.trim()) return systemInstructions;
  if (autoInner != null && autoInner.length > 0) {
    return mergeSystemWithAutoBlock(nextCore, autoInner);
  }
  // Sem auto-prompt: só substitui o núcleo se ainda não tiver o marker com a mesma estrutura
  if (userCore.includes(AGENT_PLAYBOOK_MARKER) && userCore.trim() === nextCore.trim()) {
    return systemInstructions;
  }
  return nextCore;
}
