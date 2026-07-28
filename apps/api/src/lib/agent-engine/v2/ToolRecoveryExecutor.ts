/**
 * Tool Recovery Executor — executa estratégias de recuperação (provider/model switch).
 */

import type { ToolRecoveryAction } from "./types.js";

export type RecoveryContext = {
  attempt: number;
  toolName: string;
  currentProvider?: string;
  currentModel?: string;
  alternateProviders?: string[];
  alternateModels?: string[];
};

export type RecoveryExecutionResult = {
  action: ToolRecoveryAction;
  /** Provider/modelo sugerido para retry (null = manter actual). */
  switchProvider: string | null;
  switchModel: string | null;
  shouldRetry: boolean;
  abortTurn: boolean;
};

const DEFAULT_ALT_PROVIDERS = ["openai", "google_gemini"];
const DEFAULT_ALT_MODELS: Record<string, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4o-mini"],
  google_gemini: ["gemini-2.0-flash"],
};

/**
 * Resolve acção de recuperação em instruções executáveis para o runtime.
 */
export function executeRecoveryStrategy(
  action: ToolRecoveryAction,
  ctx: RecoveryContext,
): RecoveryExecutionResult {
  switch (action.kind) {
    case "local_retry":
      return {
        action,
        switchProvider: null,
        switchModel: null,
        shouldRetry: true,
        abortTurn: false,
      };
    case "provider_switch": {
      const alts = ctx.alternateProviders ?? DEFAULT_ALT_PROVIDERS;
      const next = alts.find((p) => p !== ctx.currentProvider) ?? null;
      return {
        action,
        switchProvider: next,
        switchModel: next
          ? (ctx.alternateModels ?? DEFAULT_ALT_MODELS[next])?.[0] ?? null
          : null,
        shouldRetry: Boolean(next),
        abortTurn: !next,
      };
    }
    case "model_switch": {
      const models =
        ctx.alternateModels ??
        DEFAULT_ALT_MODELS[ctx.currentProvider ?? "openai"] ??
        [];
      const next = models.find((m) => m !== ctx.currentModel) ?? models[0] ?? null;
      return {
        action,
        switchProvider: null,
        switchModel: next,
        shouldRetry: Boolean(next),
        abortTurn: !next,
      };
    }
    case "tool_runtime_retry":
      return {
        action,
        switchProvider: null,
        switchModel: null,
        shouldRetry: true,
        abortTurn: false,
      };
    case "abort":
    default:
      return {
        action,
        switchProvider: null,
        switchModel: null,
        shouldRetry: false,
        abortTurn: true,
      };
  }
}

export type LlmRecoveryOverrides = {
  switchProvider: string | null;
  switchModel: string | null;
  recoveryAction?: ToolRecoveryAction;
};

/** Aplica overrides de provider/modelo vindos do Tool Recovery Executor. */
export function applyRecoveryToLlmConfig(
  provider: string,
  model: string,
  recovery?: LlmRecoveryOverrides | null,
): { provider: string; model: string } {
  return {
    provider: recovery?.switchProvider ?? provider,
    model: recovery?.switchModel ?? model,
  };
}
