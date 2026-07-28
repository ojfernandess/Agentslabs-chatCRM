/**
 * Tool Recovery — retry automático quando tool obrigatória falha.
 */

import type { ExecutionContract, ToolRecoveryAction } from "./types.js";

export type ToolRecoveryInput = {
  contract: ExecutionContract;
  toolName: string;
  ok: boolean;
  errorMessage?: string;
  attempt: number;
  maxAttempts?: number;
};

const MAX_ATTEMPTS = 3;

/**
 * Decide próxima acção de recuperação para tool falhada.
 */
export function planToolRecovery(input: ToolRecoveryInput): ToolRecoveryAction | null {
  if (input.ok) return null;

  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS;
  const isRequired = input.contract.requiredTools.some(
    (r) =>
      input.toolName.toLowerCase().includes(r.toLowerCase()) ||
      r.toLowerCase().includes(input.toolName.toLowerCase()),
  );
  if (!isRequired) return null;

  const attempt = input.attempt + 1;
  if (attempt > maxAttempts) {
    return {
      kind: "abort",
      toolName: input.toolName,
      reason: `Tool obrigatória falhou após ${maxAttempts} tentativas`,
      attempt,
    };
  }

  if (attempt === 1) {
    return {
      kind: "local_retry",
      toolName: input.toolName,
      reason: "Retry local da tool obrigatória",
      attempt,
    };
  }
  if (attempt === 2) {
    return {
      kind: "provider_switch",
      toolName: input.toolName,
      reason: "Retry com provider alternativo",
      attempt,
    };
  }
  return {
    kind: "tool_runtime_retry",
    toolName: input.toolName,
    reason: "Retry no Tool Runtime",
    attempt,
  };
}

/** Agrupa recoveries por tool para auditoria. */
export function mergeRecoveryActions(
  existing: ToolRecoveryAction[],
  next: ToolRecoveryAction | null,
): ToolRecoveryAction[] {
  if (!next) return existing;
  return [...existing, next];
}
