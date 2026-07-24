import type { AgentSupervisorCheck, AgentSupervisorTrace } from "../types.js";

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
};

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
    retryCount: 0,
  };
}

export function shouldRetryAfterSupervisor(
  trace: AgentSupervisorTrace,
  strictMode: boolean,
  retryCount: number,
): boolean {
  if (trace.approved) return false;
  if (retryCount >= 2) return false;
  return strictMode || trace.checks.some((c) => c.id === "tool_used" && !c.passed);
}
