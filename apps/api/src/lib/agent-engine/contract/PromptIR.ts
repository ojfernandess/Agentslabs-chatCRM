import type { TurnPolicy } from "../validators/turnPolicyParser.js";
import type { CompletionCriterion, ReplyTemplateSpec, ToolSpec, TurnPatternSpec } from "./CompletionTypes.js";
import type { FlowDefinition } from "./FlowDefinition.js";
import type { ConstraintRule, PolicyRule } from "./PolicyTypes.js";

/** Versão do schema Prompt IR — incrementar em breaking changes. */
export const PROMPT_IR_VERSION = "1.0" as const;

export type PromptIRMetadata = {
  /** Hash turn-resolved (playbook + message + policy state) */
  hash: string;
  /** Hash estável só do texto do playbook */
  playbookHash: string;
  compiledAt: string;
  playbookCharCount: number;
};

/**
 * Representação intermédia do Prompt — compilada 1× por turno.
 * O Runtime nunca re-interpreta markdown; consome apenas PromptIR + Facts.
 */
export type PromptIR = {
  promptIrVersion: typeof PROMPT_IR_VERSION;
  objective: string;
  flows: FlowDefinition[];
  tools: {
    catalog: ToolSpec[];
    required: string[];
    optional: string[];
    forbidden: string[];
  };
  policies: PolicyRule[];
  constraints: ConstraintRule[];
  completionCriteria: CompletionCriterion[];
  turnPatterns: TurnPatternSpec[];
  replyTemplates: ReplyTemplateSpec[];
  restrictions: string[];
  preconditions: string[];
  postconditions: string[];
  forbiddenSameTurnPairs: Array<{ a: string; b: string }>;
  /** Política de turno resolvida — equivalente a PromptContract.turnPolicy */
  turnPolicy: TurnPolicy;
  metadata: PromptIRMetadata;
};
