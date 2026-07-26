import { parsePromptBlocks, type PromptBlocks } from "../../agentPlaybook.js";

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

const NATIVE_TOOL_NAME_RE = new RegExp(
  `\\b(?:${KNOWN_NATIVE_TOOL_NAMES.join("|")}|oc_tool_[a-f0-9]{32})\\b`,
  "gi",
);

/** Contexto linguístico que indica obrigatoriedade explícita de ferramenta. */
const MANDATORY_CONTEXT_RE =
  /(?:obrigat[oó]ri[oa]s?|sempre\s+(?:use|usa|utiliz\w*|invoc\w*|cham\w*|consult\w*)|deve\s+(?:usar|utilizar|invocar|chamar|consultar)|must\s+(?:use|call|invoke)|always\s+(?:use|call)|antes\s+de\s+responder|nunca\s+responda\s+sem)/i;

const BACKTICK_TOOL_RE = /`([a-z_][a-z0-9_]*)`/gi;

function normalizeToolToken(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^oc_tool_[a-f0-9]{32}$/i.test(t)) return t.toLowerCase();
  if (KNOWN_NATIVE_TOOL_NAMES.includes(t as (typeof KNOWN_NATIVE_TOOL_NAMES)[number])) return t;
  return null;
}

function extractToolNamesFromText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(NATIVE_TOOL_NAME_RE)) {
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

function readPromptBlocksFromBehavior(behaviorConfig: Record<string, unknown>): PromptBlocks {
  const pb = behaviorConfig.promptBuilder;
  if (!pb || typeof pb !== "object") return parsePromptBlocks(null);
  const blocksRaw = (pb as Record<string, unknown>).blocks;
  return parsePromptBlocks(blocksRaw);
}

/**
 * Resolve ferramentas obrigatórias a partir de `behaviorConfig.promptBuilder.blocks`
 * (restrições, ferramentas, fluxos) quando há linguagem explícita de obrigatoriedade.
 */
export function resolveRequiredToolNamesFromBehavior(
  behaviorConfig: Record<string, unknown> | null | undefined,
): string[] {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return [];

  const blocks = readPromptBlocksFromBehavior(behaviorConfig);
  const merged = new Set<string>();

  for (const block of [blocks.restrictions, blocks.tools, blocks.flows]) {
    for (const name of parseRequiredToolNamesFromText(block)) {
      merged.add(name);
    }
  }

  return [...merged];
}
