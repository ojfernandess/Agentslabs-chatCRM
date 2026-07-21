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
    const merged = blocksToPromptUserCore(blocks);
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
