/**
 * Fluxos extraídos do playbook — steps com tools e condições.
 * Genérico: não codifica segmento; categorias vêm do markdown do Prompt.
 */

export type FlowStep = {
  id: string;
  label: string;
  /** Categoria do playbook (C3, S9, Passo 8, etc.) */
  category?: string;
  toolNames: string[];
  preconditions: string[];
  postconditions: string[];
  /** Linha fonte no playbook (auditoria) */
  sourceLine?: string;
};

export type FlowDefinition = {
  id: string;
  label: string;
  steps: FlowStep[];
};
