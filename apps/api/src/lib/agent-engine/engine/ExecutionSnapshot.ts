import type { ExecutionContext } from "./ExecutionContext.js";
import type { EngineExecutionPlan } from "./ExecutionPlan.js";
import type { EngineExecutionContract } from "./ExecutionContract.js";
import type { ExecutionTimelineEvent } from "./ExecutionTimeline.js";
import type { ExecutionMetrics } from "./ExecutionMetrics.js";
import type { IntentKind } from "../core/types.js";
import type { WorkflowRunStatus } from "../continuation/types.js";

/** Snapshot serializável para checkpoint / HITL / inspector / MCP. */
export type ExecutionSnapshot = {
  version: 1;
  context: ExecutionContext;
  plan: {
    requiredToolNames: string[];
    matchedPatternIds: string[];
    knowledgeSeeking: boolean;
    exclusiveAllowedTools: string[] | null;
    blockEscalation: boolean;
  };
  contract: EngineExecutionContract;
  intentKind: IntentKind;
  intentConfidence: number;
  timeline: ExecutionTimelineEvent[];
  metrics: ExecutionMetrics;
  recoveryCount: number;
  /** Estado resumido do Workflow/Step Engine (Fase 3), se activo. */
  workflow?: {
    runId: string;
    workflowId: string;
    status: WorkflowRunStatus;
    currentStepId: string | null;
    plannedToolNames: string[];
    suspendReason?: string;
  };
};

export type BuildSnapshotOpts = {
  context: ExecutionContext;
  plan: EngineExecutionPlan;
  contract: EngineExecutionContract;
  intentKind: IntentKind;
  intentConfidence: number;
  timeline: ExecutionTimelineEvent[];
  metrics: ExecutionMetrics;
  recoveryCount: number;
  workflow?: ExecutionSnapshot["workflow"];
};

export function buildExecutionSnapshot(opts: BuildSnapshotOpts): ExecutionSnapshot {
  return {
    version: 1,
    context: opts.context,
    plan: {
      requiredToolNames: opts.plan.requiredToolNames,
      matchedPatternIds: opts.plan.turnPlan.matchedPatternIds,
      knowledgeSeeking: opts.plan.turnPlan.knowledgeSeeking,
      exclusiveAllowedTools: opts.plan.turnPolicy.exclusiveAllowedTools,
      blockEscalation: opts.plan.turnPolicy.blockEscalation,
    },
    contract: opts.contract,
    intentKind: opts.intentKind,
    intentConfidence: opts.intentConfidence,
    timeline: opts.timeline,
    metrics: opts.metrics,
    recoveryCount: opts.recoveryCount,
    ...(opts.workflow ? { workflow: opts.workflow } : {}),
  };
}
