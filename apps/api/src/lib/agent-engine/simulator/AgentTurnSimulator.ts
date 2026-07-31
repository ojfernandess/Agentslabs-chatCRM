/**
 * Agent Turn Simulator — dry-run do ExecutionEngine sem LLM / outbound.
 * Útil para QA de contract/plan/scheduler/workflow antes de prod.
 */

import { buildTurnContext } from "../core/buildTurnContext.js";
import type { TurnContext } from "../core/types.js";
import {
  beginEngineTurn,
  sharedExecutionEngine,
  type EngineTurnState,
  type ExecutionSnapshot,
} from "../engine/index.js";
import {
  planScheduledToolInvocations,
  shouldRunToolScheduler,
} from "../scheduler/TurnToolScheduler.js";
import type { ScheduledToolInvocation } from "../scheduler/TurnToolScheduler.js";
import {
  parseWorkflowFromBehavior,
  startWorkflow,
  type WorkflowRunState,
} from "../continuation/index.js";
import { packMemoryForPrompt, type MemoryPackResult } from "../memory/MemoryBudgetPacker.js";
import type { MemoryRecord } from "../memory/memoryEngineTypes.js";
import type { AgentEngineConfig, AgentRuntimeExecuteInput } from "../types.js";
import { estimatePromptTokenBudget, type TokenBudgetReport } from "./TokenBudget.js";

export type SimulateTurnInput = {
  /** Input mínimo — pode ser parcial para testes. */
  organizationId: string;
  conversationId: string;
  messageId: string;
  botId: string;
  userMessage: string;
  engineConfig: AgentEngineConfig;
  behaviorConfig: Record<string, unknown>;
  memory?: Record<string, unknown>;
  availableToolNames?: string[];
  /** Memórias para packing (opcional). */
  memoryRecords?: {
    temporary?: MemoryRecord[];
    contact?: MemoryRecord[];
    agent?: MemoryRecord[];
    global?: MemoryRecord[];
  };
  /** Se true e workflow definido, corre continuation sem handlers de tool. */
  runWorkflow?: boolean;
};

export type SimulateTurnResult = {
  turnContext: TurnContext;
  engineState: EngineTurnState;
  snapshot: ExecutionSnapshot;
  scheduledPlan: ScheduledToolInvocation[];
  wouldRunScheduler: boolean;
  workflow?: WorkflowRunState | null;
  memoryPack?: MemoryPackResult;
  tokenBudget: TokenBudgetReport;
  /** Violações / avisos do dry-run. */
  warnings: string[];
};

function toFakeExecuteInput(input: SimulateTurnInput): AgentRuntimeExecuteInput {
  const now = new Date();
  return {
    organizationId: input.organizationId,
    bot: { id: input.botId } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: input.conversationId } as AgentRuntimeExecuteInput["conversation"],
    message: {
      id: input.messageId,
      body: input.userMessage,
      createdAt: now,
    } as AgentRuntimeExecuteInput["message"],
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      child: () => undefined,
      level: "info",
      fatal: () => undefined,
      trace: () => undefined,
      silent: () => undefined,
    } as unknown as AgentRuntimeExecuteInput["log"],
    engineConfig: input.engineConfig,
    llmConfig: {},
    behaviorConfig: input.behaviorConfig,
  };
}

/**
 * Simula um turno: plan + contract + scheduler plan + optional workflow + memory pack.
 * Não invoca LLM, HTTP tools, nem delivery.
 */
export async function simulateAgentTurn(input: SimulateTurnInput): Promise<SimulateTurnResult> {
  const warnings: string[] = [];
  const fakeInput = toFakeExecuteInput(input);
  let engineState = beginEngineTurn(
    fakeInput,
    input.memory,
    input.availableToolNames,
  );
  const turnContext = engineState.turnContext;

  const wouldRunScheduler = shouldRunToolScheduler(input.engineConfig, undefined);
  const scheduledPlan = planScheduledToolInvocations(turnContext, []);
  if (wouldRunScheduler && scheduledPlan.length === 0 && turnContext.executionContract.pendingToolNames.length > 0) {
    warnings.push("scheduler_would_run_but_plan_empty");
  }
  if (!turnContext.executionContract.valid) {
    const hardViolations = turnContext.executionContract.violations.filter(
      (v) => !v.startsWith("required_tool_missing:") && !v.startsWith("fact_missing:"),
    );
    for (const v of hardViolations) warnings.push(`contract:${v}`);
  }

  let workflow: WorkflowRunState | null | undefined;
  if (input.runWorkflow !== false && input.engineConfig.workflowEngineEnabled) {
    const def = parseWorkflowFromBehavior(input.behaviorConfig);
    if (def) {
      const { state } = await startWorkflow({
        definition: def,
        vars: { userMessage: input.userMessage, ...(input.memory ?? {}) },
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        persist: false,
      });
      workflow = state;
      engineState = sharedExecutionEngine.attachWorkflow(engineState, state);
      if (state.status === "suspended") {
        warnings.push(`workflow_suspended:${state.suspendReason ?? state.currentStepId}`);
      }
    }
  }

  let memoryPack: MemoryPackResult | undefined;
  if (input.memoryRecords && input.engineConfig.memoryBudgetEnabled) {
    memoryPack = packMemoryForPrompt(
      {
        temporary: input.memoryRecords.temporary ?? [],
        contact: input.memoryRecords.contact ?? [],
        agent: input.memoryRecords.agent ?? [],
        global: input.memoryRecords.global ?? [],
      },
      {
        promptTokenBudget: input.engineConfig.memoryTokenBudget ?? 1200,
        defaultTtlSeconds: input.engineConfig.memoryDefaultTtlSeconds ?? 0,
      },
    );
    if (memoryPack.truncated) {
      warnings.push(
        `memory_truncated:dropped=${memoryPack.droppedIds.length},expired=${memoryPack.expiredIds.length}`,
      );
    }
  }

  const tokenBudget = estimatePromptTokenBudget({
    systemPromptChars: 0,
    userMessage: input.userMessage,
    memoryTokens: memoryPack?.tokensUsed,
    memoryBudget: memoryPack?.tokensBudget ?? input.engineConfig.memoryTokenBudget,
    pendingTools: turnContext.executionContract.pendingToolNames.length,
  });

  engineState = sharedExecutionEngine.finalize(engineState, "simulate");
  const snapshot = sharedExecutionEngine.snapshot(engineState);

  return {
    turnContext,
    engineState,
    snapshot,
    scheduledPlan,
    wouldRunScheduler,
    workflow,
    memoryPack,
    tokenBudget,
    warnings,
  };
}

/** Recompila TurnContext puro (sem Engine) — útil em unit tests. */
export function simulateTurnContextOnly(opts: {
  turnId: string;
  behaviorConfig: Record<string, unknown>;
  userMessage: string;
  availableToolNames?: string[];
  memory?: Record<string, unknown>;
}): TurnContext {
  return buildTurnContext(opts);
}
