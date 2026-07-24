import type { PromptValidationResult } from "../types.js";

export type PromptValidationInput = {
  blocks?: Record<string, string | undefined>;
  userCore?: string;
  connectedToolCount?: number;
  hasMemoryConfig?: boolean;
  hasFallbacks?: boolean;
};

const BLOCK_CHECKS: Array<{
  id: string;
  label: string;
  weight: number;
  key?: string;
  test?: (input: PromptValidationInput) => boolean;
}> = [
  { id: "objective", label: "Objetivo definido", weight: 15, key: "objective" },
  { id: "personality", label: "Personalidade", weight: 15, key: "personality" },
  { id: "restrictions", label: "Restrições", weight: 12, key: "restrictions" },
  { id: "flows", label: "Fluxos", weight: 12, key: "flows" },
  { id: "examples", label: "Exemplos", weight: 10, key: "examples" },
  {
    id: "tools",
    label: "Ferramentas documentadas",
    weight: 10,
    test: (i) => (i.connectedToolCount ?? 0) > 0 || Boolean(i.blocks?.tools?.trim()),
  },
  {
    id: "memory",
    label: "Memória configurada",
    weight: 8,
    test: (i) => i.hasMemoryConfig === true || Boolean(i.blocks?.memory?.trim()),
  },
  {
    id: "fallback",
    label: "Fallback definido",
    weight: 8,
    test: (i) =>
      i.hasFallbacks === true ||
      Boolean(i.blocks?.fallback?.trim()) ||
      Boolean(i.blocks?.escalation?.trim()),
  },
  {
    id: "core",
    label: "Prompt principal preenchido",
    weight: 10,
    test: (i) => Boolean(i.userCore?.trim()) || Boolean(i.blocks?.objective?.trim()),
  },
];

function blockFilled(blocks: Record<string, string | undefined> | undefined, key: string): boolean {
  return Boolean(blocks?.[key]?.trim());
}

/** Score 0–100 antes de publicar um agente. */
export function validateAgentPrompt(input: PromptValidationInput): PromptValidationResult {
  const checks = BLOCK_CHECKS.map((c) => {
    let passed = false;
    if (c.key) passed = blockFilled(input.blocks, c.key);
    else if (c.test) passed = c.test(input);
    return {
      id: c.id,
      label: c.label,
      weight: c.weight,
      passed,
      detail: passed ? undefined : "Pendente",
    };
  });

  const earned = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
  const maxScore = checks.reduce((s, c) => s + c.weight, 0);
  const score = maxScore > 0 ? Math.round((earned / maxScore) * 100) : 0;

  return {
    score,
    maxScore: 100,
    checks,
    ready: score >= 70,
  };
}
