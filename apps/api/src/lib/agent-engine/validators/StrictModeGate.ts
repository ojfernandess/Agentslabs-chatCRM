import type { AgentSupervisorTrace, ToolValidationResult } from "../types.js";
import { buildSupervisorTrace } from "../supervisor/AgentSupervisorService.js";
import { validateToolExecution } from "./ToolValidator.js";

/** Limiar mínimo de confiança para enviar resposta com modo estrito activo. */
export const STRICT_MODE_MIN_CONFIDENCE = 90;

export type StrictModeEvaluationInput = {
  strictMode: boolean;
  replyText: string;
  userMessage: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
  kbHasUsefulExcerpts?: boolean;
  llmSupervisorApproved?: boolean | null;
  hasSubstantiveReply?: boolean;
  toolValidation?: ToolValidationResult;
  supervisorTrace?: AgentSupervisorTrace;
};

export type StrictModeEvaluation = {
  confidence: number;
  blockSend: boolean;
  reasons: string[];
  minConfidence: number;
  toolValidation: ToolValidationResult;
  supervisorTrace: AgentSupervisorTrace;
};

function hasSubstantiveReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (/^(só um momento|aguarde|vou verificar|um instante)/i.test(t)) return false;
  return true;
}

/** Score heurístico 0–100 antes do envio ao cliente. */
export function computeReplyConfidence(input: Omit<StrictModeEvaluationInput, "strictMode">): number {
  let score = 100;

  if (input.toolValidation) {
    score -= input.toolValidation.alerts.length * 12;
    if (input.toolValidation.blockSend) score = Math.min(score, 60);
    if (input.toolValidation.fallbackSuggested) score = Math.min(score, 75);
  }

  const failedChecks = input.supervisorTrace?.checks.filter((c) => !c.passed) ?? [];
  score -= failedChecks.length * 14;
  if (input.supervisorTrace && !input.supervisorTrace.approved) {
    score = Math.min(score, 68);
  }

  if (input.llmSupervisorApproved === false) score = Math.min(score, 52);
  if (input.llmSupervisorApproved === true) score = Math.min(100, score + 4);

  const substantive = input.hasSubstantiveReply ?? hasSubstantiveReply(input.replyText);
  if (!substantive) score = Math.min(score, 35);

  const successfulTools = input.toolOutcomes.filter((t) => t.ok);
  const failedTools = input.toolOutcomes.filter((t) => !t.ok);
  if (failedTools.length > 0) score = Math.min(score, 55);
  if (
    successfulTools.length > 0 &&
    /^(só um momento|aguarde|vou verificar)/i.test(input.replyText.trim())
  ) {
    score = Math.min(score, 50);
  }

  if (input.kbHasUsefulExcerpts && !substantive) score = Math.min(score, 45);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function evaluateStrictModeGate(input: StrictModeEvaluationInput): StrictModeEvaluation {
  const toolValidation =
    input.toolValidation ??
    validateToolExecution({
      toolOutcomes: input.toolOutcomes,
      replyText: input.replyText,
      strictMode: input.strictMode,
    });

  const supervisorTrace =
    input.supervisorTrace ??
    buildSupervisorTrace({
      userMessage: input.userMessage,
      replyText: input.replyText,
      toolSummary: input.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
      kbHasUsefulExcerpts: input.kbHasUsefulExcerpts === true,
      successfulToolCount: input.toolOutcomes.filter((t) => t.ok).length,
      totalToolCount: input.toolOutcomes.length,
      strictMode: input.strictMode,
      llmApproved: input.llmSupervisorApproved ?? undefined,
    });

  const confidence = computeReplyConfidence({
    replyText: input.replyText,
    userMessage: input.userMessage,
    toolOutcomes: input.toolOutcomes,
    kbHasUsefulExcerpts: input.kbHasUsefulExcerpts,
    llmSupervisorApproved: input.llmSupervisorApproved,
    hasSubstantiveReply: input.hasSubstantiveReply,
    toolValidation,
    supervisorTrace,
  });

  const reasons: string[] = [];
  if (toolValidation.alerts.length > 0) reasons.push(...toolValidation.alerts);
  for (const check of supervisorTrace.checks) {
    if (!check.passed) reasons.push(`${check.label}${check.detail ? `: ${check.detail}` : ""}`);
  }
  if (input.llmSupervisorApproved === false) {
    reasons.push("Supervisor IA rejeitou a resposta");
  }

  const blockSend =
    input.strictMode && input.replyText.trim().length > 0 && confidence < STRICT_MODE_MIN_CONFIDENCE;

  if (blockSend) {
    reasons.push(
      `Confiança ${confidence}% abaixo do mínimo ${STRICT_MODE_MIN_CONFIDENCE}% (modo estrito)`,
    );
  }

  return {
    confidence,
    blockSend,
    reasons: [...new Set(reasons)],
    minConfidence: STRICT_MODE_MIN_CONFIDENCE,
    toolValidation,
    supervisorTrace,
  };
}
