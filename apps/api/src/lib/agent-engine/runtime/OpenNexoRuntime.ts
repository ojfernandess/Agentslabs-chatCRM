import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";

export type NativeAgentExecutor = (
  input: AgentRuntimeExecuteInput,
) => Promise<{ reply: string; toolOutcomes?: Array<{ name: string; ok: boolean; preview: string }> }>;

/**
 * Runtime padrão — delega ao pipeline nativo existente (`generateNativeAgentReplyCore`).
 */
export class OpenNexoRuntime implements AgentRuntime {
  readonly kind = "openconduit" as const;

  constructor(private readonly executor: NativeAgentExecutor) {}

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    const traceBuilder = new ExecutionTraceBuilder({
      runtime: "openconduit",
      memory: input.engineConfig.memory,
      strictMode: input.engineConfig.strictMode,
      observability: input.engineConfig.observability,
    });

    traceBuilder.startNode("load_memory", "Carregar memória");
    const memory = createMemoryProvider(input.engineConfig.memory);
    const memSnap = await memory.load(input.conversation.id, input.organizationId);
    traceBuilder.setMemorySnapshot(memSnap);
    traceBuilder.endNode("load_memory");

    traceBuilder.startNode("respond", "OpenNexo Runtime");
    const { reply, toolOutcomes = [] } = await this.executor(input);
    traceBuilder.endNode("respond");

    if (toolOutcomes.length > 0) {
      traceBuilder.startNode("validate_result", "Validar ferramentas");
      const validation = validateToolExecution({
        toolOutcomes,
        replyText: reply,
        strictMode: input.engineConfig.strictMode,
      });
      if (!validation.ok) {
        for (const a of validation.alerts) traceBuilder.addError(a);
        input.executionLog?.warn(
          { id: "tool_validator", name: "Tool Validator" },
          validation.alerts.join("; "),
        );
      }
      traceBuilder.endNode("validate_result", validation.ok ? "ok" : "warn", validation.alerts.join("; "));
    }

    input.executionLog?.info(
      { id: "agent_engine", name: "Agent Engine" },
      JSON.stringify({ runtime: "openconduit", strict: input.engineConfig.strictMode }),
    );

    return { reply, trace: traceBuilder.build() };
  }
}
