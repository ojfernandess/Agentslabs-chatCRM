import { buildTurnContext, type BuildTurnContextOpts } from "../core/buildTurnContext.js";
import type { TurnContext } from "../core/types.js";
import type { ToolOutcomeForEil, FactStore } from "../eil/types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import {
  createExecutionContext,
  type ExecutionContext,
} from "./ExecutionContext.js";
import { enginePlanFromTurn, type EngineExecutionPlan } from "./ExecutionPlan.js";
import type { EngineExecutionContract } from "./ExecutionContract.js";
import {
  appendTimelineEvent,
  createExecutionTimeline,
  type ExecutionTimelineEvent,
} from "./ExecutionTimeline.js";
import {
  createExecutionMetrics,
  finalizeMetrics,
  recordPhaseMs,
  type ExecutionMetrics,
  type ExecutionPhaseName,
} from "./ExecutionMetrics.js";
import { buildExecutionSnapshot, type ExecutionSnapshot } from "./ExecutionSnapshot.js";
import { decideEngineRecovery, type EngineRecoveryOpts } from "./ExecutionRecovery.js";
import type { ResilienceDecision } from "../resilience/TurnResilience.js";
import type { WorkflowRunState } from "../continuation/types.js";
import { workflowSnapshotSlice } from "../continuation/runContinuation.js";

/**
 * Estado vivo da Execution Engine num turno.
 * Fonte única de plan/contract — runtimes não devem re-resolver turn policy fora daqui.
 */
export type EngineTurnState = {
  context: ExecutionContext;
  turnContext: TurnContext;
  plan: EngineExecutionPlan;
  contract: EngineExecutionContract;
  timeline: ExecutionTimelineEvent[];
  metrics: ExecutionMetrics;
  recoveryCount: number;
  memory?: Record<string, unknown>;
  /** Workflow/Step Engine (Fase 3) — opcional. */
  workflowRun?: WorkflowRunState | null;
};

export type BeginTurnOpts = {
  input: AgentRuntimeExecuteInput;
  memory?: Record<string, unknown>;
  availableToolNames?: string[];
  toolOutcomes?: ToolOutcomeForEil[];
  priorFacts?: FactStore;
  toolConfigs?: Array<{ name: string; config?: unknown }>;
};

function turnIdFromInput(input: AgentRuntimeExecuteInput): string {
  return `${input.conversation.id}:${input.message.id}`;
}

function syncPlanContract(state: EngineTurnState, turnContext: TurnContext): EngineTurnState {
  const plan = enginePlanFromTurn(turnContext.turnPlan, turnContext.eilPlan);
  return {
    ...state,
    turnContext,
    plan,
    contract: turnContext.executionContract,
  };
}

/**
 * Execution Engine — spine partilhado por OpenNexo, LangGraph e facades.
 * beginTurn → refreshTurn → decideRecovery → snapshot / finalize.
 */
export class ExecutionEngine {
  beginTurn(opts: BeginTurnOpts): EngineTurnState {
    const t0 = Date.now();
    const { input } = opts;
    const userMessage = input.message.body ?? "";
    const context = createExecutionContext({
      turnId: turnIdFromInput(input),
      organizationId: input.organizationId,
      botId: input.bot.id,
      conversationId: input.conversation.id,
      messageId: input.message.id,
      userMessage,
      runtime: input.engineConfig.runtime,
      engineConfig: input.engineConfig,
      availableToolNames: opts.availableToolNames,
    });

    const buildOpts: BuildTurnContextOpts = {
      turnId: context.turnId,
      behaviorConfig: input.behaviorConfig,
      userMessage,
      availableToolNames: opts.availableToolNames ?? context.availableToolNames,
      memory: opts.memory,
      toolOutcomes: opts.toolOutcomes,
      priorFacts: opts.priorFacts,
      toolConfigs: opts.toolConfigs,
    };
    const turnContext = buildTurnContext(buildOpts);
    const plan = enginePlanFromTurn(turnContext.turnPlan, turnContext.eilPlan);
    let timeline = createExecutionTimeline();
    timeline = appendTimelineEvent(timeline, "begin", `runtime=${context.runtime}`);
    timeline = appendTimelineEvent(timeline, "plan", `required=${plan.requiredToolNames.join(",") || "none"}`, {
      intent: turnContext.intent.kind,
      exclusive: plan.turnPolicy.exclusiveAllowedTools,
      promptHash: turnContext.promptContract.promptHash,
    });
    let metrics = createExecutionMetrics();
    metrics = recordPhaseMs(metrics, "plan", Date.now() - t0);

    return {
      context,
      turnContext,
      plan,
      contract: turnContext.executionContract,
      timeline,
      metrics,
      recoveryCount: 0,
      memory: opts.memory,
    };
  }

  /**
   * Recompila contrato/EIL após tools — única via permitida para actualizar plan/contract no turno.
   */
  refreshTurnWithBehavior(
    state: EngineTurnState,
    behaviorConfig: Record<string, unknown> | null | undefined,
    opts: {
      toolOutcomes?: ToolOutcomeForEil[];
      memory?: Record<string, unknown>;
      priorFacts?: FactStore;
      phase?: ExecutionPhaseName;
    } = {},
  ): EngineTurnState {
    const t0 = Date.now();
    const memory = opts.memory ?? state.memory;
    const turnContext = buildTurnContext({
      turnId: state.context.turnId,
      behaviorConfig,
      userMessage: state.context.userMessage,
      availableToolNames: state.context.availableToolNames,
      memory,
      toolOutcomes: opts.toolOutcomes,
      priorFacts: opts.priorFacts ?? state.turnContext.facts,
    });
    let next = syncPlanContract({ ...state, memory }, turnContext);
    const phase = opts.phase ?? "validate";
    next = {
      ...next,
      timeline: appendTimelineEvent(
        next.timeline,
        phase === "schedule" ? "schedule" : phase === "recover" ? "recover" : "validate",
        `pending=${next.contract.pendingToolNames.join(",") || "none"}`,
        summarizeContractMeta(next.contract),
        Date.now() - t0,
      ),
      metrics: recordPhaseMs(next.metrics, phase, Date.now() - t0),
    };
    return next;
  }

  attachWorkflow(state: EngineTurnState, workflowRun: WorkflowRunState | null | undefined): EngineTurnState {
    return { ...state, workflowRun: workflowRun ?? null };
  }

  recordPhase(
    state: EngineTurnState,
    phase: ExecutionPhaseName,
    detail?: string,
    metadata?: Record<string, unknown>,
    durationMs = 0,
  ): EngineTurnState {
    const timelinePhase =
      phase === "execute_llm"
        ? "execute_llm"
        : phase === "schedule"
          ? "schedule"
          : phase === "workflow"
            ? "workflow"
            : phase === "recover"
              ? "recover"
              : phase === "finalize"
                ? "finalize"
                : phase === "plan"
                  ? "plan"
                  : "validate";
    return {
      ...state,
      timeline: appendTimelineEvent(state.timeline, timelinePhase, detail, metadata, durationMs),
      metrics: durationMs > 0 ? recordPhaseMs(state.metrics, phase, durationMs) : state.metrics,
    };
  }

  decideRecovery(opts: EngineRecoveryOpts): ResilienceDecision {
    return decideEngineRecovery(opts);
  }

  bumpRecovery(state: EngineTurnState): EngineTurnState {
    return { ...state, recoveryCount: state.recoveryCount + 1 };
  }

  snapshot(state: EngineTurnState): ExecutionSnapshot {
    const metrics = finalizeMetrics(state.metrics, state.context.startedAt);
    return buildExecutionSnapshot({
      context: state.context,
      plan: state.plan,
      contract: state.contract,
      intentKind: state.turnContext.intent.kind,
      intentConfidence: state.turnContext.intent.confidence,
      timeline: state.timeline,
      metrics,
      recoveryCount: state.recoveryCount,
      workflow: workflowSnapshotSlice(state.workflowRun),
    });
  }

  finalize(state: EngineTurnState, detail?: string): EngineTurnState {
    const metrics = finalizeMetrics(state.metrics, state.context.startedAt);
    return {
      ...state,
      metrics,
      timeline: appendTimelineEvent(state.timeline, "finalize", detail, {
        totalMs: metrics.totalMs,
        contractValid: state.contract.valid,
      }),
    };
  }
}

function summarizeContractMeta(contract: EngineExecutionContract): Record<string, unknown> {
  return {
    valid: contract.valid,
    pending: contract.pendingToolNames,
    satisfied: contract.satisfiedToolNames,
  };
}

/** Singleton helper — instâncias são stateless; pode reutilizar. */
export const sharedExecutionEngine = new ExecutionEngine();

/** Atalho: beginTurn a partir do input + memória já carregada. */
export function beginEngineTurn(
  input: AgentRuntimeExecuteInput,
  memory?: Record<string, unknown>,
  availableToolNames?: string[],
): EngineTurnState {
  return sharedExecutionEngine.beginTurn({ input, memory, availableToolNames });
}
