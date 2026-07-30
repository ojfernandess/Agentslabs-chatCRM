import type { AgentRuntimeExecuteInput } from "../types.js";

export type ProgressEmitResult = {
  /** True se um aviso intermedio foi pedido (caller decide enviar). */
  shouldEmit: boolean;
  message: string;
};

/**
 * Progresso ao contacto só na fase ACT (antes das tools), nunca como reply final.
 * Em runtime_owned o Scheduler ja corre as tools — o aviso e configuravel via toolCallNotify.
 */
export function resolveActProgressMessage(opts: {
  toolExecutionMode: "runtime_owned" | "hybrid";
  plannedToolNames: string[];
  behaviorConfig: Record<string, unknown> | null | undefined;
}): ProgressEmitResult {
  if (opts.plannedToolNames.length === 0) {
    return { shouldEmit: false, message: "" };
  }
  const raw = opts.behaviorConfig?.toolCallNotify;
  if (!raw || typeof raw !== "object") {
    return { shouldEmit: false, message: "" };
  }
  const o = raw as Record<string, unknown>;
  if (o.enabled !== true) {
    return { shouldEmit: false, message: "" };
  }
  // Em runtime_owned nao emitir progresso generico que soe a «ainda vou invocar»
  // (o reply synthesizer entrega o resultado). Hybrid pode avisar antes do LLM act.
  if (opts.toolExecutionMode === "runtime_owned") {
    return { shouldEmit: false, message: "" };
  }
  const message =
    typeof o.message === "string" && o.message.trim()
      ? o.message.trim().slice(0, 500)
      : "Um momento, estou a consultar isso para si…";
  return { shouldEmit: true, message };
}

/** Log-only helper — nao envia WhatsApp daqui (evita acoplamento). */
export function logActProgress(
  input: AgentRuntimeExecuteInput,
  progress: ProgressEmitResult,
  planned: string[],
): void {
  if (!progress.shouldEmit) return;
  input.executionLog?.info(
    { id: "act_progress", name: "Progresso ACT" },
    JSON.stringify({ planned, message: progress.message.slice(0, 120) }),
  );
}
