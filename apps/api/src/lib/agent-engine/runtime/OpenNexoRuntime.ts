import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { createMemoryProvider as defaultCreateMemoryProvider } from "../memory/MemoryProvider.js";
import { executeRuntimeStream, type StreamRuntimeEvent } from "./StreamingRuntime.js";
import { runWorkflowRuntimeTurn } from "./WorkflowRuntimeOrchestrator.js";

export type NativeAgentKbMeta = {
  hasUsefulExcerpts: boolean;
  coversQuery: boolean;
};

export type NativeAgentExecutorResult = {
  reply: string;
  toolOutcomes?: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  kbMeta?: NativeAgentKbMeta;
  llmSupervisorApproved?: boolean | null;
  llmSupervisorSummary?: string;
};

export type NativeAgentExecutor = (
  input: AgentRuntimeExecuteInput,
) => Promise<NativeAgentExecutorResult>;

export type OpenNexoRuntimeDeps = {
  createMemoryProvider?: typeof defaultCreateMemoryProvider;
};

/**
 * Motor Padrão — executor do Workflow Runtime.
 * Delega toda a orquestração a `runWorkflowRuntimeTurn`
 * (Workflow → Planner → Contract → Scheduler → Tools → Facts → LLM → Reply).
 */
export class OpenNexoRuntime implements AgentRuntime {
  readonly kind = "openconduit" as const;
  private readonly memoryFactory: typeof defaultCreateMemoryProvider;

  constructor(
    private readonly executor: NativeAgentExecutor,
    deps?: OpenNexoRuntimeDeps,
  ) {
    this.memoryFactory = deps?.createMemoryProvider ?? defaultCreateMemoryProvider;
  }

  executeStream(input: AgentRuntimeExecuteInput): AsyncGenerator<StreamRuntimeEvent> {
    return executeRuntimeStream(this, input);
  }

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    return runWorkflowRuntimeTurn(input, this.executor, {
      runtimeLabel: "openconduit",
      createMemoryProvider: this.memoryFactory,
    });
  }
}
