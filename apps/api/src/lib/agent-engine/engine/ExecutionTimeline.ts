/** Evento append-only da Execution Engine (alimenta inspector / Langfuse). */
export type ExecutionTimelinePhase =
  | "begin"
  | "plan"
  | "schedule"
  | "workflow"
  | "execute_llm"
  | "validate"
  | "recover"
  | "finalize"
  | "custom";

export type ExecutionTimelineEvent = {
  at: string;
  phase: ExecutionTimelinePhase;
  detail?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export function createExecutionTimeline(): ExecutionTimelineEvent[] {
  return [];
}

export function appendTimelineEvent(
  timeline: ExecutionTimelineEvent[],
  phase: ExecutionTimelinePhase,
  detail?: string,
  metadata?: Record<string, unknown>,
  durationMs?: number,
): ExecutionTimelineEvent[] {
  return [
    ...timeline,
    {
      at: new Date().toISOString(),
      phase,
      detail,
      durationMs,
      metadata,
    },
  ];
}

export function timelineToInspectorEntries(
  timeline: ExecutionTimelineEvent[],
): Array<{ id: string; name: string; level: string; message: string; at: string }> {
  return timeline.map((e, i) => ({
    id: `engine_${e.phase}_${i}`,
    name: `ExecutionEngine:${e.phase}`,
    level: "INFO",
    message: JSON.stringify({
      phase: e.phase,
      detail: e.detail,
      durationMs: e.durationMs,
      ...(e.metadata ?? {}),
    }),
    at: e.at,
  }));
}
