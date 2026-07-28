import type { AgentEngineConfig, AgentSupervisorTrace } from "../types.js";
import type { ExecutionContract } from "../core/types.js";

/** Acção de resiliência genérica — sem regras de segmento. */
export type ResilienceActionKind =
  | "continue"
  | "recover_mandatory_tools"
  | "reply_only_retry"
  | "apply_fallback"
  | "block";

export type ResilienceConfig = {
  /** Activa recovery + fallback + self-healing (default false). */
  enabled: boolean;
  /** Máximo de recovers determinísticos por turno (default 1). */
  maxMandatoryRecoveries: number;
  /** Mensagem segura quando esgota retries e bloqueia outbound. */
  blockedFallbackMessage: string;
  /** Detectar reply idêntica entre retries e parar (default true). */
  detectValidationLoops: boolean;
};

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  enabled: false,
  maxMandatoryRecoveries: 1,
  blockedFallbackMessage:
    "Não consegui concluir esta etapa com segurança. Pode repetir o pedido ou contactar a nossa equipa?",
  detectValidationLoops: true,
};

export type DecideResilienceOpts = {
  config: ResilienceConfig;
  strictMode: boolean;
  supervisorTrace?: AgentSupervisorTrace | null;
  executionContract?: ExecutionContract | null;
  retryCount: number;
  recoveryCount: number;
  previousReply?: string;
  replyText?: string;
  toolOutcomes?: Array<{ name: string; ok: boolean }>;
};

export type ResilienceDecision = {
  action: ResilienceActionKind;
  reason: string;
  pendingToolNames: string[];
  fallbackMessage?: string;
};

const TOOL_MISSING_CHECK_IDS = new Set([
  "required_tools_contract",
  "execution_contract_valid",
  "validation_passed",
  "eil_plan_followed",
  "tool_used",
  "tools_not_ignored",
]);

const QUALITY_CHECK_IDS = new Set([
  "prompt_coherent",
  "knowledge_used",
  "no_hallucination",
  "context_used",
  "no_execution_loop",
]);

function failedCheckIds(trace?: AgentSupervisorTrace | null): string[] {
  return (trace?.checks ?? []).filter((c) => !c.passed).map((c) => c.id);
}

function isValidationLoop(opts: DecideResilienceOpts): boolean {
  if (!opts.config.detectValidationLoops) return false;
  if ((opts.retryCount ?? 0) < 1) return false;
  const prev = (opts.previousReply ?? "").trim();
  const cur = (opts.replyText ?? "").trim();
  if (!prev || !cur) return false;
  return prev === cur;
}

/**
 * Decide a próxima acção de resiliência após o Supervisor.
 * Preferência: recover tools → reply-only → fallback → block.
 */
export function decideResilienceAction(opts: DecideResilienceOpts): ResilienceDecision {
  if (!opts.config.enabled) {
    return { action: "continue", reason: "resilience_disabled", pendingToolNames: [] };
  }

  const trace = opts.supervisorTrace;
  if (!trace || trace.approved) {
    return { action: "continue", reason: "supervisor_approved", pendingToolNames: [] };
  }

  const failed = failedCheckIds(trace);
  const pending =
    opts.executionContract?.pendingToolNames.filter(Boolean) ??
    [];
  const hasToolGap =
    pending.length > 0 ||
    failed.some((id) => TOOL_MISSING_CHECK_IDS.has(id));
  const hasQualityGap = failed.some((id) => QUALITY_CHECK_IDS.has(id));
  const hasSuccessfulTool = (opts.toolOutcomes ?? []).some((t) => t.ok);

  if (isValidationLoop(opts)) {
    return {
      action: opts.strictMode ? "apply_fallback" : "block",
      reason: "validation_loop_detected",
      pendingToolNames: pending,
      fallbackMessage: opts.config.blockedFallbackMessage,
    };
  }

  if (
    hasToolGap &&
    pending.length > 0 &&
    opts.recoveryCount < opts.config.maxMandatoryRecoveries
  ) {
    return {
      action: "recover_mandatory_tools",
      reason: `mandatory_tool_recovery:${pending.slice(0, 3).join(",")}`,
      pendingToolNames: pending,
    };
  }

  if (
    hasQualityGap &&
    hasSuccessfulTool &&
    !hasToolGap &&
    opts.retryCount < 2
  ) {
    return {
      action: "reply_only_retry",
      reason: "quality_retry_after_tools",
      pendingToolNames: [],
    };
  }

  if (opts.retryCount < 2 && hasToolGap && pending.length === 0) {
    // Falha de tools sem pending no contrato — retry completo via LLM
    return {
      action: "reply_only_retry",
      reason: "supervisor_retry_without_pending",
      pendingToolNames: [],
    };
  }

  if (opts.strictMode && opts.retryCount >= 2) {
    return {
      action: "apply_fallback",
      reason: "retries_exhausted",
      pendingToolNames: pending,
      fallbackMessage: opts.config.blockedFallbackMessage,
    };
  }

  if (opts.strictMode) {
    return {
      action: "block",
      reason: failed.slice(0, 3).join(";") || "supervisor_rejected",
      pendingToolNames: pending,
    };
  }

  return { action: "continue", reason: "non_strict_pass", pendingToolNames: pending };
}

export function parseResilienceConfig(
  engineConfig: AgentEngineConfig,
  behaviorConfig?: Record<string, unknown> | null,
): ResilienceConfig {
  const fromEngine = engineConfig.resilienceEnabled === true;
  let blockedFallbackMessage = DEFAULT_RESILIENCE_CONFIG.blockedFallbackMessage;
  let maxMandatoryRecoveries = DEFAULT_RESILIENCE_CONFIG.maxMandatoryRecoveries;
  let detectValidationLoops = DEFAULT_RESILIENCE_CONFIG.detectValidationLoops;

  const raw =
    behaviorConfig && typeof behaviorConfig === "object"
      ? (behaviorConfig.agentEngine as Record<string, unknown> | undefined)
      : undefined;
  if (raw && typeof raw === "object") {
    if (typeof raw.blockedFallbackMessage === "string" && raw.blockedFallbackMessage.trim()) {
      blockedFallbackMessage = raw.blockedFallbackMessage.trim().slice(0, 500);
    }
    if (
      typeof raw.maxMandatoryRecoveries === "number" &&
      raw.maxMandatoryRecoveries >= 0 &&
      raw.maxMandatoryRecoveries <= 3
    ) {
      maxMandatoryRecoveries = Math.floor(raw.maxMandatoryRecoveries);
    }
    if (raw.detectValidationLoops === false) detectValidationLoops = false;
  }

  return {
    enabled: fromEngine || engineConfig.resilienceEnabled === true,
    maxMandatoryRecoveries,
    blockedFallbackMessage,
    detectValidationLoops,
  };
}
