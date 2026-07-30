import type { AgentSupervisorCheck, AgentSupervisorTrace } from "../types.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import type { ConstraintViolation, ExecutionIntelligencePlan } from "../eil/types.js";
import type { TurnPolicy } from "../validators/turnPolicyParser.js";
import { formatTurnPolicyForSupervisor, isLikelyMutableOrCompletionTool } from "../validators/turnPolicyParser.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import type { ExecutionContract } from "../core/types.js";
import { formatExecutionContractForSupervisor } from "../core/executionContractFormat.js";

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
  /** Política de turno parseada — fallback quando não há ExecutionContract. */
  turnPolicy?: TurnPolicy | null;
  /** Contrato de execução compilado (Fase 3 — fonte preferida). */
  executionContract?: ExecutionContract | null;
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
  turnPolicy?: TurnPolicy | null;
  executionContract?: ExecutionContract | null;
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
    turnPolicy: opts.turnPolicy ?? null,
    executionContract: opts.executionContract ?? null,
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
      const hints = i.turnPolicy?.completionToolHints ?? [];
      const completionRan = (i.toolOutcomes ?? []).some(
        (o) => o.ok && isLikelyMutableOrCompletionTool(o.name, hints),
      );
      if (completionRan && i.strictMode) {
        if (t.length >= 120) return true;
        if (/\b(conclu[ií]d|confirmad|realizad|sucesso|finalizad|check[\s-]?in)\b/i.test(t)) {
          return true;
        }
        return false;
      }
      if (i.strictMode && /^(só um momento|aguarde|vou verificar)/i.test(t)) {
        return i.successfulToolCount === 0;
      }
      return t.length >= 8;
    },
  },
  {
    id: "completion_reply",
    label: "Resposta após tool de conclusão",
    run: (i) => {
      const hints = i.turnPolicy?.completionToolHints ?? [];
      const completionRan = (i.toolOutcomes ?? []).some(
        (o) => o.ok && isLikelyMutableOrCompletionTool(o.name, hints),
      );
      if (!completionRan) return true;
      const t = i.replyText.trim();
      if (t.length >= 120) return true;
      if (/\b(conclu[ií]d|confirmad|realizad|sucesso|finalizad|check[\s-]?in)\b/i.test(t)) {
        return true;
      }
      return !i.strictMode;
    },
  },
  {
    id: "completion_claim_without_tool",
    label: "Sem afirmar conclusão sem tool de check-in",
    run: (i) => {
      const claimsCompletion =
        /check-in (foi )?conclu[ií]d|pedido (foi )?confirmado|reserva (foi )?confirmada|check[\s-]?in (realizad|efetuad|feito)/i.test(
          i.replyText,
        );
      if (!claimsCompletion) return true;
      const hints = i.turnPolicy?.completionToolHints ?? [];
      const hasCompletionTool = (i.toolOutcomes ?? []).some(
        (t) =>
          t.ok &&
          (hints.some((h) => toolOutcomeSatisfiesRequired(h, [t])) ||
            /check[_-]?in|submit|confirm|concluir|finalize/i.test(t.name)),
      );
      return hasCompletionTool;
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
    id: "execution_contract_valid",
    label: "Contrato de execução válido",
    run: (i) => !i.executionContract || i.executionContract.valid,
  },
  {
    id: "required_tools_contract",
    label: "Tools obrigatórias do contrato satisfeitas",
    run: (i) => {
      if (!i.executionContract) return true;
      return i.executionContract.pendingToolNames.length === 0;
    },
  },
  {
    id: "forbidden_tools_contract",
    label: "Sem tools proibidas pelo contrato",
    run: (i) => {
      if (!i.executionContract) return true;
      return !i.executionContract.violations.some((v) => v.startsWith("forbidden_tool_used:"));
    },
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
  const contractNote =
    input.executionContract && !allPassed
      ? formatExecutionContractForSupervisor(input.executionContract).slice(0, 220)
      : null;
  const turnPolicyNote =
    !contractNote &&
    input.turnPolicy &&
    !allPassed &&
    input.validationBlockSend
      ? formatTurnPolicyForSupervisor(input.turnPolicy)
      : null;
  const structuralSummary = allPassed
    ? "Validação estrutural aprovada"
    : checks
        .filter((c) => !c.passed)
        .map((c) => c.detail ?? c.label)
        .join("; ") ||
      (contractNote
        ? `Contrato: ${contractNote.slice(0, 180)}`
        : turnPolicyNote
          ? `Política de turno: ${turnPolicyNote.slice(0, 180)}`
          : "Falhas na validação");
  return {
    approved: allPassed && (input.llmApproved !== false),
    summary: input.llmSummary ?? structuralSummary,
    checks,
    retryCount: input.retryCount ?? 0,
  };
}

const RETRYABLE_CHECK_IDS = new Set([
  "tool_used",
  "knowledge_used",
  "tools_not_ignored",
  "validation_passed",
  "execution_contract_valid",
  "required_tools_contract",
  "forbidden_tools_contract",
  "prompt_coherent",
  "completion_reply",
  "completion_claim_without_tool",
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

/** Bloqueia envio após esgotar retries quando supervisor reprova em modo estrito.
 * Sempre bloqueia se o agente afirmou check-in concluído sem tool OK (anti-alucinação).
 */
export function shouldBlockReplyAfterSupervisor(
  trace: AgentSupervisorTrace,
  strictMode: boolean,
  retryCount: number,
): boolean {
  if (trace.approved) return false;
  const claimedWithoutTool = trace.checks.some(
    (c) => c.id === "completion_claim_without_tool" && !c.passed,
  );
  if (claimedWithoutTool) return true;
  if (!strictMode) return false;
  if (retryCount < 2) return false;
  return true;
}
