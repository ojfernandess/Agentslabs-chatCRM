import type {
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeKind,
  AgentRuntimeState,
} from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import {
  buildSupervisorTrace,
  shouldRetryAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";

export type OrchestrationState = {
  input: AgentRuntimeExecuteInput;
  executor: NativeAgentExecutor;
  traceBuilder: ExecutionTraceBuilder;
  memory: Record<string, unknown>;
  reply: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
  retryCount: number;
  supervisorApproved: boolean;
};

export type OrchestrationHook = (state: OrchestrationState) => Promise<void>;

export type OrchestrationPlan = {
  graphHistory: string[];
  preMemory?: OrchestrationHook[];
  postExecute?: (state: OrchestrationState) => Promise<"continue" | "retry">;
  postMemory?: OrchestrationHook[];
  maxRetries?: number;
};

export async function runOrchestratedRuntime(
  kind: AgentRuntimeKind,
  input: AgentRuntimeExecuteInput,
  executor: NativeAgentExecutor,
  plan: OrchestrationPlan,
): Promise<{ result: AgentRuntimeExecuteResult; runtimeState: AgentRuntimeState }> {
  const traceBuilder = new ExecutionTraceBuilder({
    runtime: kind,
    memory: input.engineConfig.memory,
    strictMode: input.engineConfig.strictMode,
    observability: input.engineConfig.observability,
  });

  const state: OrchestrationState = {
    input,
    executor,
    traceBuilder,
    memory: {},
    reply: "",
    toolOutcomes: [],
    retryCount: 0,
    supervisorApproved: true,
  };

  const maxRetries = plan.maxRetries ?? 2;

  for (const hook of plan.preMemory ?? []) {
    await hook(state);
  }

  traceBuilder.startNode("load_memory", "Carregar memória");
  const provider = createMemoryProvider(input.engineConfig.memory);
  state.memory = await provider.load(input.conversation.id, input.organizationId);
  traceBuilder.setMemorySnapshot(state.memory);
  traceBuilder.endNode("load_memory");

  for (;;) {
    traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
    const { reply, toolOutcomes = [] } = await executor(input);
    state.reply = reply;
    state.toolOutcomes = toolOutcomes;
    traceBuilder.endNode("execute_tool");

    traceBuilder.startNode("validate_result", "Validar resultado");
    const validation = validateToolExecution({
      toolOutcomes: state.toolOutcomes,
      replyText: state.reply,
      strictMode: input.engineConfig.strictMode,
    });
    if (!validation.ok) {
      for (const alert of validation.alerts) traceBuilder.addError(alert);
      input.executionLog?.warn(
        { id: "tool_validator", name: "Tool Validator" },
        validation.alerts.join("; "),
      );
    }
    traceBuilder.endNode(
      "validate_result",
      validation.blockSend && input.engineConfig.strictMode ? "error" : "ok",
    );

    if (input.engineConfig.supervisorEnabled) {
      traceBuilder.startNode("supervisor", "Supervisor IA");
      const successful = state.toolOutcomes.filter((t) => t.ok).length;
      const supTrace = buildSupervisorTrace({
        userMessage: input.message.body ?? "",
        replyText: state.reply,
        toolSummary: state.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
        kbHasUsefulExcerpts: false,
        successfulToolCount: successful,
        totalToolCount: state.toolOutcomes.length,
        strictMode: input.engineConfig.strictMode,
      });
      state.supervisorApproved = supTrace.approved;
      traceBuilder.endNode("supervisor", supTrace.approved ? "ok" : "warn", supTrace.summary);
    } else {
      state.supervisorApproved = true;
    }

    if (plan.postExecute) {
      const decision = await plan.postExecute(state);
      if (decision === "retry" && state.retryCount < maxRetries) {
        state.retryCount += 1;
        continue;
      }
    } else if (
      !state.supervisorApproved &&
      shouldRetryAfterSupervisor(
        buildSupervisorTrace({
          userMessage: input.message.body ?? "",
          replyText: state.reply,
          toolSummary: state.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
          kbHasUsefulExcerpts: false,
          successfulToolCount: state.toolOutcomes.filter((t) => t.ok).length,
          totalToolCount: state.toolOutcomes.length,
          strictMode: input.engineConfig.strictMode,
        }),
        input.engineConfig.strictMode,
        state.retryCount,
      ) &&
      state.retryCount < maxRetries
    ) {
      state.retryCount += 1;
      continue;
    }

    break;
  }

  for (const hook of plan.postMemory ?? []) {
    await hook(state);
  }

  traceBuilder.startNode("update_memory", "Atualizar memória");
  await provider.saveLegacy(input.conversation.id, input.organizationId, {
    userMessage: input.message.body ?? "",
    assistantMessage: state.reply,
    lastReplyPreview: state.reply.slice(0, 500),
    lastToolOutcomes: state.toolOutcomes.slice(0, 10),
    botId: input.bot.id,
    contactId: input.contactId ?? null,
  });
  traceBuilder.endNode("update_memory");

  traceBuilder.startNode("respond", "Responder utilizador");
  traceBuilder.endNode("respond");

  const trace = traceBuilder.build();
  input.executionLog?.info(
    { id: "agent_engine", name: `${kind} Runtime` },
    JSON.stringify({ runtime: kind, nodes: trace.nodes.length, retries: state.retryCount }),
  );

  return {
    result: { reply: state.reply, trace },
    runtimeState: {
      status: "completed",
      graphHistory: plan.graphHistory,
      checkpointId: `${input.conversation.id}:${input.message.id}`,
    },
  };
}

export class OrchestratedRuntimeBase {
  protected state: AgentRuntimeState = { status: "idle", graphHistory: [] };

  constructor(
    public readonly kind: AgentRuntimeKind,
    protected readonly executor: NativeAgentExecutor,
    protected readonly plan: OrchestrationPlan,
  ) {}

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    this.state = { status: "running", graphHistory: [], currentNode: "load_memory" };
    const { result, runtimeState } = await runOrchestratedRuntime(
      this.kind,
      input,
      this.executor,
      this.plan,
    );
    this.state = runtimeState;
    return result;
  }

  getState(): AgentRuntimeState {
    return { ...this.state, graphHistory: [...this.state.graphHistory] };
  }

  async pause(): Promise<void> {
    this.state = { ...this.state, status: "paused" };
  }

  async resume(): Promise<void> {
    this.state = { ...this.state, status: "running" };
  }

  async interrupt(): Promise<void> {
    this.state = { ...this.state, status: "interrupted" };
  }

  async continue(): Promise<void> {
    this.state = { ...this.state, status: "running" };
  }
}
