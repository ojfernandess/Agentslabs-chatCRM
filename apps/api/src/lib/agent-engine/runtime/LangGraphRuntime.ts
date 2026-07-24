import { Annotation, END, START, StateGraph, MemorySaver } from "@langchain/langgraph";
import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult, AgentRuntimeState } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { buildSupervisorTrace, shouldRetryAfterSupervisor } from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";

type GraphState = {
  input: AgentRuntimeExecuteInput;
  memory: Record<string, unknown>;
  reply: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
  retryCount: number;
  traceBuilder: ExecutionTraceBuilder;
  supervisorApproved: boolean;
};

const GraphStateAnnotation = Annotation.Root({
  input: Annotation<AgentRuntimeExecuteInput>,
  memory: Annotation<Record<string, unknown>>,
  reply: Annotation<string>,
  toolOutcomes: Annotation<Array<{ name: string; ok: boolean; preview: string }>>,
  retryCount: Annotation<number>,
  traceBuilder: Annotation<ExecutionTraceBuilder>,
  supervisorApproved: Annotation<boolean>,
});

/**
 * LangGraph Runtime — orquestra o fluxo via StateGraph sem expor LangGraph ao resto do CRM.
 */
export class LangGraphRuntime implements AgentRuntime {
  readonly kind = "langgraph" as const;
  private state: AgentRuntimeState = { status: "idle", graphHistory: [] };
  private checkpointer = new MemorySaver();

  constructor(private readonly executor: NativeAgentExecutor) {}

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    this.state = { status: "running", graphHistory: [], currentNode: "classify_intent" };

    const traceBuilder = new ExecutionTraceBuilder({
      runtime: "langgraph",
      memory: input.engineConfig.memory,
      strictMode: input.engineConfig.strictMode,
      observability: input.engineConfig.observability,
    });

    const graph = this.buildGraph();
    const threadId = `${input.conversation.id}:${input.message.id}`;

    const result = await graph.invoke(
      {
        input,
        memory: {},
        reply: "",
        toolOutcomes: [],
        retryCount: 0,
        traceBuilder,
        supervisorApproved: false,
      },
      {
        configurable: { thread_id: threadId },
      },
    );

    this.state = {
      status: "completed",
      graphHistory: [
        "classify_intent",
        "load_memory",
        "select_tool",
        "execute_tool",
        "validate_result",
        "supervisor",
        "update_memory",
        "respond",
      ],
      checkpointId: threadId,
    };

    const trace = result.traceBuilder.build();
    input.executionLog?.info(
      { id: "agent_engine", name: "LangGraph Runtime" },
      JSON.stringify({ runtime: "langgraph", nodes: trace.nodes.length }),
    );

    return { reply: result.reply, trace };
  }

  private buildGraph() {
    const executor = this.executor;

    const classifyIntent = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("classify_intent", "Classificar intenção");
      state.traceBuilder.setNextNode("load_memory");
      state.traceBuilder.endNode("classify_intent");
      return {};
    };

    const loadMemory = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("load_memory", "Carregar memória");
      const provider = createMemoryProvider(state.input.engineConfig.memory);
      const memory = await provider.load(
        state.input.conversation.id,
        state.input.organizationId,
      );
      state.traceBuilder.setMemorySnapshot(memory);
      state.traceBuilder.setNextNode("select_tool");
      state.traceBuilder.endNode("load_memory");
      return { memory };
    };

    const selectTool = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("select_tool", "Selecionar ferramenta");
      state.traceBuilder.setNextNode("execute_tool");
      state.traceBuilder.endNode("select_tool");
      return {};
    };

    const executeTool = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
      const { reply, toolOutcomes = [] } = await executor(state.input);
      state.traceBuilder.setNextNode("validate_result");
      state.traceBuilder.endNode("execute_tool");
      return { reply, toolOutcomes };
    };

    const validateResult = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("validate_result", "Validar resultado");
      const validation = validateToolExecution({
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        strictMode: state.input.engineConfig.strictMode,
      });
      if (!validation.ok) {
        for (const a of validation.alerts) state.traceBuilder.addError(a);
        state.input.executionLog?.warn(
          { id: "tool_validator", name: "Tool Validator" },
          validation.alerts.join("; "),
        );
      }
      state.traceBuilder.setNextNode("supervisor");
      state.traceBuilder.endNode(
        "validate_result",
        validation.blockSend && state.input.engineConfig.strictMode ? "error" : "ok",
      );
      return {};
    };

    const supervisor = async (state: GraphState): Promise<Partial<GraphState>> => {
      if (!state.input.engineConfig.supervisorEnabled) {
        return { supervisorApproved: true };
      }
      state.traceBuilder.startNode("supervisor", "Supervisor IA");
      const successful = state.toolOutcomes.filter((t) => t.ok).length;
      const supTrace = buildSupervisorTrace({
        userMessage: state.input.message.body ?? "",
        replyText: state.reply,
        toolSummary: state.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
        kbHasUsefulExcerpts: false,
        successfulToolCount: successful,
        totalToolCount: state.toolOutcomes.length,
        strictMode: state.input.engineConfig.strictMode,
      });
      const trace = state.traceBuilder.build();
      trace.supervisor = supTrace;

      const retry = shouldRetryAfterSupervisor(
        supTrace,
        state.input.engineConfig.strictMode,
        state.retryCount,
      );
      state.traceBuilder.setNextNode(retry ? "execute_tool" : "update_memory");
      state.traceBuilder.endNode("supervisor", supTrace.approved ? "ok" : "warn", supTrace.summary);
      return {
        supervisorApproved: supTrace.approved,
        retryCount: retry ? state.retryCount + 1 : state.retryCount,
      };
    };

    const updateMemory = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("update_memory", "Atualizar memória");
      const provider = createMemoryProvider(state.input.engineConfig.memory);
      await provider.saveLegacy(state.input.conversation.id, state.input.organizationId, {
        userMessage: state.input.message.body ?? "",
        assistantMessage: state.reply,
        lastReplyPreview: state.reply.slice(0, 500),
        lastToolOutcomes: state.toolOutcomes.slice(0, 10),
        botId: state.input.bot.id,
        contactId: state.input.contactId ?? null,
      });
      state.traceBuilder.setNextNode("respond");
      state.traceBuilder.endNode("update_memory");
      return {};
    };

    const respond = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("respond", "Responder utilizador");
      state.traceBuilder.endNode("respond");
      return {};
    };

    const routeAfterSupervisor = (state: GraphState): string => {
      if (
        !state.supervisorApproved &&
        shouldRetryAfterSupervisor(
          buildSupervisorTrace({
            userMessage: state.input.message.body ?? "",
            replyText: state.reply,
            toolSummary: "",
            kbHasUsefulExcerpts: false,
            successfulToolCount: 0,
            totalToolCount: state.toolOutcomes.length,
            strictMode: state.input.engineConfig.strictMode,
          }),
          state.input.engineConfig.strictMode,
          state.retryCount,
        )
      ) {
        return "execute_tool";
      }
      return "update_memory";
    };

    return new StateGraph(GraphStateAnnotation)
      .addNode("classify_intent", classifyIntent)
      .addNode("load_memory", loadMemory)
      .addNode("select_tool", selectTool)
      .addNode("execute_tool", executeTool)
      .addNode("validate_result", validateResult)
      .addNode("supervisor", supervisor)
      .addNode("update_memory", updateMemory)
      .addNode("respond", respond)
      .addEdge(START, "classify_intent")
      .addEdge("classify_intent", "load_memory")
      .addEdge("load_memory", "select_tool")
      .addEdge("select_tool", "execute_tool")
      .addEdge("execute_tool", "validate_result")
      .addEdge("validate_result", "supervisor")
      .addConditionalEdges("supervisor", routeAfterSupervisor, {
        execute_tool: "execute_tool",
        update_memory: "update_memory",
      })
      .addEdge("update_memory", "respond")
      .addEdge("respond", END)
      .compile({ checkpointer: this.checkpointer });
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
