export type ExecutionPhaseName =
  | "plan"
  | "schedule"
  | "workflow"
  | "execute_llm"
  | "validate"
  | "supervisor"
  | "recover"
  | "finalize";

export type ExecutionMetrics = {
  phaseMs: Partial<Record<ExecutionPhaseName, number>>;
  totalMs?: number;
};

export function createExecutionMetrics(): ExecutionMetrics {
  return { phaseMs: {} };
}

export function recordPhaseMs(
  metrics: ExecutionMetrics,
  phase: ExecutionPhaseName,
  durationMs: number,
): ExecutionMetrics {
  return {
    ...metrics,
    phaseMs: {
      ...metrics.phaseMs,
      [phase]: (metrics.phaseMs[phase] ?? 0) + Math.max(0, durationMs),
    },
  };
}

export function finalizeMetrics(metrics: ExecutionMetrics, startedAtIso: string): ExecutionMetrics {
  const started = Date.parse(startedAtIso);
  const totalMs = Number.isFinite(started) ? Math.max(0, Date.now() - started) : undefined;
  return { ...metrics, totalMs };
}
