/**
 * Smart Fallback — elimina fallback cego para plain chat.
 */

import { pendingRequiredToolNames } from "../contract/TurnExecutionContract.js";
import type { ExecutionContract, SmartFallbackDecision } from "./types.js";

export type SmartFallbackInput = {
  contract: ExecutionContract;
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  errorKind: "llm_timeout" | "llm_error" | "tool_failure" | "validation_failure" | "supervisor_block";
  errorMessage?: string;
  retryCount?: number;
  maxRetries?: number;
};

const MAX_TOOL_RETRIES = 3;

/**
 * Decide se plain-chat fallback é permitido.
 * Só permite fallback textual quando nenhuma tool obrigatória está pendente.
 */
export function evaluateSmartFallback(input: SmartFallbackInput): SmartFallbackDecision {
  const pending = pendingRequiredToolNames(input.contract.turnPlan, input.toolOutcomes);
  const hasPendingRequired = pending.length > 0;
  const retryCount = input.retryCount ?? 0;
  const maxRetries = input.maxRetries ?? MAX_TOOL_RETRIES;

  if (hasPendingRequired) {
    const canRetry = retryCount < maxRetries;
    return {
      allowPlainChat: false,
      allowReplyGeneration: false,
      reason: `Ferramentas obrigatórias pendentes: ${pending.join(", ")}`,
      retryToolRuntime: canRetry,
      escalateProvider: canRetry && retryCount >= 1,
      operationalError: canRetry
        ? null
        : `Plano incompleto após ${retryCount} tentativas — tools pendentes: ${pending.join(", ")}`,
    };
  }

  // Tools OK mas LLM falhou — retry tool runtime antes de plain chat
  if (input.errorKind === "llm_timeout" || input.errorKind === "llm_error") {
    const canRetry = retryCount < maxRetries;
    return {
      allowPlainChat: !canRetry,
      allowReplyGeneration: !canRetry,
      reason: canRetry
        ? "Erro LLM — retry tool runtime antes de fallback"
        : "Erro LLM persistente — fallback plain chat permitido (sem tools pendentes)",
      retryToolRuntime: canRetry,
      escalateProvider: canRetry && retryCount >= 1,
      operationalError: canRetry ? null : input.errorMessage ?? "LLM failure after retries",
    };
  }

  if (input.errorKind === "tool_failure") {
    const failedRequired = input.toolOutcomes.filter(
      (t) => !t.ok && input.contract.requiredTools.some((r) => t.name.toLowerCase().includes(r.toLowerCase())),
    );
    if (failedRequired.length > 0) {
      return {
        allowPlainChat: false,
        allowReplyGeneration: false,
        reason: `Tool obrigatória falhou: ${failedRequired.map((t) => t.name).join(", ")}`,
        retryToolRuntime: retryCount < maxRetries,
        escalateProvider: retryCount >= 1,
        operationalError:
          retryCount >= maxRetries
            ? `Tool recovery esgotado: ${failedRequired.map((t) => t.name).join(", ")}`
            : null,
      };
    }
  }

  if (input.errorKind === "supervisor_block" || input.errorKind === "validation_failure") {
    const hasSuccessfulTools = input.toolOutcomes.some((t) => t.ok);
    return {
      allowPlainChat: false,
      allowReplyGeneration: hasSuccessfulTools,
      reason: hasSuccessfulTools
        ? "Supervisor/validação reprovou — reply-only permitido (tools OK)"
        : "Supervisor/validação reprovou — retry tool runtime",
      retryToolRuntime: !hasSuccessfulTools && retryCount < maxRetries,
      escalateProvider: false,
      operationalError: null,
    };
  }

  return {
    allowPlainChat: true,
    allowReplyGeneration: true,
    reason: "Sem tools pendentes — fallback permitido",
    retryToolRuntime: false,
    escalateProvider: false,
    operationalError: null,
  };
}
