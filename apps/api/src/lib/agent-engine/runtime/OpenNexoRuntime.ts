import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { resolveUnifiedSpineMode } from "./UnifiedSpineBridge.js";
import { executeRuntimeStream, type StreamRuntimeEvent } from "./StreamingRuntime.js";

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

/**
 * Motor Padrão (openconduit) — delega ao executor nativo.
 * Com `unifiedSpineMode` ≠ off, ExecutionEngine governa plan/contract (Fase 2).
 */
export class OpenNexoRuntime implements AgentRuntime {
  readonly kind = "openconduit" as const;

  constructor(private readonly executor: NativeAgentExecutor) {}

  executeStream(input: AgentRuntimeExecuteInput): AsyncGenerator<StreamRuntimeEvent> {
    return executeRuntimeStream(this, input);
  }

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    const spineMode = resolveUnifiedSpineMode(input.engineConfig);
    const traceBuilder = new ExecutionTraceBuilder({
      runtime: "openconduit",
      memory: input.engineConfig.memory,
      strictMode: input.engineConfig.strictMode,
      observability: input.engineConfig.observability,
    });
    traceBuilder.emitEvent(
      "start",
      spineMode === "off"
        ? "Motor Padrão — sandbox linear"
        : spineMode === "only"
          ? "Motor Padrão — unified spine only (LLM adapter)"
          : `Motor Padrão — unified spine (${spineMode})`,
    );
    traceBuilder.startNode("respond", "Native linear reply");
    const result = await this.executor(input);
    traceBuilder.endNode(
      "respond",
      "ok",
      result.reply ? `reply ${result.reply.length} chars` : "empty reply",
    );
    return {
      reply: result.reply,
      toolOutcomes: result.toolOutcomes,
      trace: traceBuilder.build(),
    };
  }
}
