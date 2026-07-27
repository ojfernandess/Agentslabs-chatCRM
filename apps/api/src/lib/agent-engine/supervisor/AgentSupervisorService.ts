import type { AgentSupervisorCheck, AgentSupervisorTrace } from "../types.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import type { ConstraintViolation, ExecutionIntelligencePlan } from "../eil/types.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";

export type SupervisorValidationInput = {
  userMessage: string;
  replyText: string;
  toolSummary: string;
  kbHasUsefulExcerpts: boolean;
  successfulToolCount: number;
  totalToolCount: number;
  strictMode: boolean;
  llmApproved?: boolean;
  llmSummary?: string;
  retryCount?: number;
  previousReply?: string;
  memorySnapshot?: Record<string, unknown>;
  kbQueryLikely?: boolean;
  kbToolInvoked?: boolean;
  kbToolSucceeded?: boolean;
  validationBlockSend?: boolean;
  /** EIL — quando ausente/desactivado, checks EIL passam (no-op). */
  eilEnabled?: boolean;
  eilPlan?: ExecutionIntelligencePlan;
  eilViolations?: ConstraintViolation[];
  eilRequiredFactsMissing?: string[];
  toolOutcomes?: Array<{ name: string; ok: boolean; preview?: string }>;
};

export type BuildSupervisorValidationInputOpts = {
  userMessage: string;
  replyText: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
  kbMeta: { hasUsefulExcerpts: boolean; coversQuery: boolean };
  strictMode: boolean;
  memorySnapshot?: Record<string, unknown>;
  retryCount?: number;
  previousReply?: string;
  llmApproved?: boolean | null;
  llmSummary?: string;
  validationBlockSend?: boolean;
  kbQueryLikely?: boolean;
  eilEnabled?: boolean;
  eilPlan?: ExecutionIntelligencePlan;
  eilViolations?: ConstraintViolation[];
  eilRequiredFactsMissing?: string[];
};

function memoryHasSubstantive(snapshot?: Record<string, unknown>): boolean {
  if (!snapshot || Object.keys(snapshot).length === 0) return false;
  return JSON.stringify(snapshot).length > 80;
}

/** Constrói input unificado para o supervisor estrutural (evita duplicação entre runtimes). */
export function buildSupervisorValidationInput(
  opts: BuildSupervisorValidationInputOpts,
): SupervisorValidationInput {
  const kbTool = opts.toolOutcomes.find((t) => t.name === "buscar_conhecimento");
  return {
    userMessage: opts.userMessage,
    replyText: opts.replyText,
    toolSummary: opts.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
    kbHasUsefulExcerpts: opts.kbMeta.coversQuery || opts.kbMeta.hasUsefulExcerpts,
    successfulToolCount: opts.toolOutcomes.filter((t) => t.ok).length,
    totalToolCount: opts.toolOutcomes.length,
    strictMode: opts.strictMode,
    memorySnapshot: opts.memorySnapshot,
    retryCount: opts.retryCount,
    previousReply: opts.previousReply,
    llmApproved: opts.llmApproved ?? undefined,
    llmSummary: opts.llmSummary,
    validationBlockSend: opts.validationBlockSend,
    kbQueryLikely:
      opts.kbQueryLikely ?? userMessageLooksLikeKnowledgeSeekingQuery(opts.userMessage),
    kbToolInvoked: !!kbTool,
    kbToolSucceeded: kbTool?.ok ?? false,
    eilEnabled: opts.eilEnabled,
    eilPlan: opts.eilPlan,
    eilViolations: opts.eilViolations,
    eilRequiredFactsMissing: opts.eilRequiredFactsMissing,
    toolOutcomes: opts.toolOutcomes,
  };
}

const CHECK_DEFS: Array<{
  id: string;
  label: string;
  run: (input: SupervisorValidationInput) => boolean;
}> = [
  {
    id: "tool_used",
    label: "Resultado de ferramenta considerado",
    run: (i) =>
      i.totalToolCount === 0 ||
      i.successfulToolCount > 0 ||
      !/invent|alucin/i.test(i.replyText),
  },
  {
    id: "no_hallucination",
    label: "Sem alucinação evidente",
    run: (i) => !/\[dado inventado\]|não tenho acesso mas/i.test(i.replyText),
  },
  {
    id: "prompt_coherent",
    label: "Resposta substantiva",
    run: (i) => {
      const t = i.replyText.trim();
      if (!t) return false;
      if (i.strictMode && /^(só um momento|aguarde|vou verificar)/i.test(t)) {
        return i.successfulToolCount === 0;
      }
      return t.length >= 8;
    },
  },
  {
    id: "context_used",
    label: "Contexto utilizado",
    run: (i) => i.kbHasUsefulExcerpts || i.userMessage.length < 20 || i.replyText.length > 20,
  },
  {
    id: "knowledge_used",
    label: "Conhecimento utilizado quando necessário",
    run: (i) => {
      if (!i.kbQueryLikely) return true;
      if (i.kbHasUsefulExcerpts || i.kbToolSucceeded) return true;
      if (!i.strictMode) return i.replyText.trim().length >= 24;
      if (/^(só um momento|aguarde|vou verificar|um instante)/i.test(i.replyText.trim())) {
        return false;
      }
      return i.replyText.trim().length >= 40;
    },
  },
  {
    id: "memory_considered",
    label: "Memória disponível considerada",
    run: (i) => {
      if (!memoryHasSubstantive(i.memorySnapshot)) return true;
      return i.replyText.trim().length >= 8;
    },
  },
  {
    id: "tools_not_ignored",
    label: "Ferramentas não ignoradas",
    run: (i) => {
      if (i.totalToolCount > 0 && i.successfulToolCount === 0 && i.strictMode) return false;
      if (
        i.kbQueryLikely &&
        !i.kbToolInvoked &&
        !i.kbHasUsefulExcerpts &&
        i.strictMode &&
        /^(só um momento|aguarde|vou verificar)/i.test(i.replyText.trim())
      ) {
        return false;
      }
      return true;
    },
  },
  {
    id: "no_execution_loop",
    label: "Sem loop de execução",
    run: (i) => {
      if ((i.retryCount ?? 0) >= 2 && !i.replyText.trim()) return false;
      if (
        i.previousReply &&
        i.previousReply.trim() === i.replyText.trim() &&
        (i.retryCount ?? 0) > 0
      ) {
        return !i.strictMode;
      }
      return true;
    },
  },
  {
    id: "validation_passed",
    label: "Validação de ferramentas aprovada",
    run: (i) => !i.validationBlockSend,
  },
  {
    id: "eil_plan_followed",
    label: "Plano EIL seguido (tools obrigatórias)",
    run: (i) => {
      if (!i.eilEnabled || !i.eilPlan) return true;
      const required = i.eilPlan.requiredToolNames ?? [];
      if (required.length === 0) return true;
      const outcomes = i.toolOutcomes ?? [];
      return required.every((name) => toolOutcomeSatisfiesRequired(name, outcomes));
    },
  },
  {
    id: "eil_required_facts",
    label: "Facts EIL obrigatórios presentes",
    run: (i) => {
      if (!i.eilEnabled) return true;
      return !(i.eilRequiredFactsMissing && i.eilRequiredFactsMissing.length > 0);
    },
  },
  {
    id: "eil_constraints",
    label: "Constraints EIL sem violação",
    run: (i) => {
      if (!i.eilEnabled) return true;
      return !(i.eilViolations && i.eilViolations.length > 0);
    },
  },
  {
    id: "eil_forbidden_action",
    label: "Acção proibida pelo plano EIL",
    run: (i) => {
      if (!i.eilEnabled || !i.eilPlan) return true;
      const forbidden = new Set(i.eilPlan.forbiddenActions ?? []);
      if (forbidden.size === 0) return true;
      // Se há violations com action em forbidden, já capturado em eil_constraints;
      // aqui falha se replyActions implícitas estão em forbidden via violations.
      return !(i.eilViolations ?? []).some(
        (v) => v.action && forbidden.has(v.action),
      );
    },
  },
];

export function buildSupervisorTrace(input: SupervisorValidationInput): AgentSupervisorTrace {
  const checks: AgentSupervisorCheck[] = CHECK_DEFS.map((c) => ({
    id: c.id,
    label: c.label,
    passed: c.run(input),
  }));

  if (input.llmApproved != null) {
    checks.push({
      id: "llm_supervisor",
      label: "Supervisor IA (LLM)",
      passed: input.llmApproved,
      detail: input.llmSummary,
    });
  }

  const allPassed = checks.every((c) => c.passed);
  return {
    approved: allPassed && (input.llmApproved !== false),
    summary: input.llmSummary ?? (allPassed ? "Validação estrutural aprovada" : "Falhas na validação"),
    checks,
    retryCount: input.retryCount ?? 0,
  };
}

const RETRYABLE_CHECK_IDS = new Set([
  "tool_used",
  "knowledge_used",
  "tools_not_ignored",
  "validation_passed",
  "prompt_coherent",
  "no_execution_loop",
  "eil_plan_followed",
  "eil_required_facts",
  "eil_constraints",
  "eil_forbidden_action",
]);

export function shouldRetryAfterSupervisor(
  trace: AgentSupervisorTrace,
  strictMode: boolean,
  retryCount: number,
): boolean {
  if (trace.approved) return false;
  if (retryCount >= 2) return false;
  if (strictMode && trace.checks.some((c) => !c.passed && RETRYABLE_CHECK_IDS.has(c.id))) {
    return true;
  }
  return trace.checks.some((c) => c.id === "tool_used" && !c.passed);
}

/** Bloqueia envio após esgotar retries quando supervisor reprova em modo estrito. */
export function shouldBlockReplyAfterSupervisor(
  trace: AgentSupervisorTrace,
  strictMode: boolean,
  retryCount: number,
): boolean {
  if (trace.approved) return false;
  if (!strictMode) return false;
  if (retryCount < 2) return false;
  return true;
}
