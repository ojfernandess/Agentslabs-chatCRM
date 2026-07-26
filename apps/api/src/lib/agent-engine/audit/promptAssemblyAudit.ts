import { AGENT_PLAYBOOK_MARKER, PLAYBOOK_PRIORITY_KEYS } from "../../agentPlaybook.js";
import type { PromptBlockKey } from "../../agentPlaybook.js";
import type { PromptValidationInput } from "../validators/PromptValidator.js";
import { validateAgentPrompt } from "../validators/PromptValidator.js";

export type PromptAssemblyAuditResult = {
  loadedCompletely: boolean;
  variablesSubstituted: boolean;
  truncated: boolean;
  duplicated: boolean;
  playbookOrderOk: boolean;
  restrictionsPresent: boolean;
  score: number;
  ready: boolean;
  issues: string[];
};

const TRUNCATION_RE = /(\.{3}\s*$|_truncated|\[truncated\])/i;

const PLAYBOOK_HEADING: Record<PromptBlockKey, string> = {
  personality: "Personalidade",
  objective: "Objetivo",
  restrictions: "Restrições (obrigatório",
  tools: "Ferramentas",
  memory: "Memória",
  flows: "Fluxos",
  fallback: "Fallback",
  examples: "Exemplos",
};

/** Audita integridade do prompt antes/durante execução (Fase 1 QA). */
export function auditPromptAssembly(input: {
  systemPrompt?: string;
  promptValidation?: PromptValidationInput;
}): PromptAssemblyAuditResult {
  const issues: string[] = [];
  const system = input.systemPrompt?.trim() ?? "";
  const validation = input.promptValidation
    ? validateAgentPrompt(input.promptValidation)
    : null;

  const truncated = TRUNCATION_RE.test(system);
  if (truncated) issues.push("Prompt truncado detectado no system");

  const markerCount = system.split(AGENT_PLAYBOOK_MARKER).length - 1;
  const duplicated = markerCount > 1;
  if (duplicated) issues.push("Marker do playbook duplicado no system prompt");

  let playbookOrderOk = true;
  if (system.includes(AGENT_PLAYBOOK_MARKER)) {
    const positions = PLAYBOOK_PRIORITY_KEYS.map((key) => {
      const heading = `## ${PLAYBOOK_HEADING[key]}`;
      const idx = system.indexOf(heading);
      return { key, idx };
    }).filter((p) => p.idx >= 0);
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].idx < positions[i - 1].idx) {
        playbookOrderOk = false;
        issues.push("Ordem das secções do playbook fora de PLAYBOOK_PRIORITY_KEYS");
        break;
      }
    }
  }

  const restrictionsPresent =
    Boolean(input.promptValidation?.blocks?.restrictions?.trim()) ||
    /## Restrições/i.test(system);

  const loadedCompletely = system.length > 0 && !truncated;
  const variablesSubstituted = !/\{\{[a-zA-Z_]+\}\}/.test(system);

  if (!variablesSubstituted) {
    issues.push("Variáveis de template não substituídas ({{...}})");
  }
  if (validation && !validation.ready) {
    issues.push(`Score de prompt abaixo do mínimo (${validation.score}/100)`);
  }

  return {
    loadedCompletely,
    variablesSubstituted,
    truncated,
    duplicated,
    playbookOrderOk,
    restrictionsPresent,
    score: validation?.score ?? (system.length > 100 ? 70 : 0),
    ready: validation?.ready ?? system.length > 80,
    issues,
  };
}
