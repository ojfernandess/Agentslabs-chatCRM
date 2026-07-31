/**
 * LangGraph Runtime — StateGraph oficial agent ↔ tools (LangGraph.js).
 *
 * Diagnóstico 12:14–12:16: com `workflowRuntimeShared` o runtime delegava ao
 * WorkflowRuntimeOrchestrator (spine híbrido do Motor Padrão) e falhava no check-in
 * sem usar o grafo. Este rewrite: zero `runWorkflowRuntimeTurn`.
 *
 * Padrão docs: agent (LLM) → toolsCondition → tools → agent → END.
 * @see https://docs.langchain.com/oss/javascript/langgraph/overview
 */
import {
  Annotation,
  END,
  START,
  StateGraph,
  MessagesAnnotation,
  interrupt,
  isGraphInterrupt,
} from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentRuntime } from "./AgentRuntime.js";
import type {
  AgentCheckpointStoreKind,
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeState,
} from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { resolveUnifiedSpineMode } from "./UnifiedSpineBridge.js";
import {
  getAgentGraphCheckpointer,
  persistGraphCheckpointSnapshot,
  readGraphCheckpointSnapshot,
  readGraphCheckpointSnapshotWithFallback,
  type GraphCheckpointSnapshot,
} from "../checkpoint/AgentCheckpointFactory.js";
import { registerHitlPending } from "../hitl/HumanInTheLoopStore.js";
import { ingestAgentTraceToLangfuse, isLangfuseConfigured } from "../observability/LangfuseBridge.js";
import { ingestAgentTraceToOtel } from "../observability/OtelBridge.js";
import { executeRuntimeStream, type StreamRuntimeEvent } from "./StreamingRuntime.js";
import { publishGraphEvent } from "../observability/AgentGraphEventBus.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";

const LANGGRAPH_TIMEOUT_MS = 120_000;
const MAX_TOOL_ROUNDS = 8;

export type LangGraphAgentLlmResult = {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
};

export type LangGraphRuntimeDeps = {
  createMemoryProvider?: (organizationId: string, kind: string) => unknown;
  /**
   * Um passo de LLM (sem executar tools). Em testes: injectar tool_calls.
   * Em produção sem override: o nó `agent` usa o executor nativo linear (sandbox).
   */
  invokeAgentLlm?: (input: {
    messages: BaseMessage[];
    crm: AgentRuntimeExecuteInput;
    round: number;
  }) => Promise<LangGraphAgentLlmResult>;
  /** Override da execução de uma tool (default: invokeSingleNativeAgentTool). */
  invokeTool?: (
    name: string,
    args: Record<string, unknown>,
    crm: AgentRuntimeExecuteInput,
  ) => Promise<string>;
};

type ToolOutcome = { name: string; ok: boolean; preview: string; structuredPayload?: unknown };

const CrmGraphAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  organizationId: Annotation<string>,
  conversationId: Annotation<string>,
  botId: Annotation<string>,
  reply: Annotation<string>,
  toolOutcomes: Annotation<ToolOutcome[]>({
    reducer: (left, right) => left.concat(right ?? []),
    default: () => [],
  }),
  crmInput: Annotation<AgentRuntimeExecuteInput>,
  agentRound: Annotation<number>,
  hitlPendingId: Annotation<string | undefined>,
});

type CrmGraphState = typeof CrmGraphAnnotation.State;

function lastAiHasToolCalls(messages: BaseMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isAIMessage(m)) {
      return Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    }
  }
  return false;
}

function extractFinalReply(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isAIMessage(m) && (!m.tool_calls || m.tool_calls.length === 0)) {
      const c = m.content;
      if (typeof c === "string") return c.trim();
      if (Array.isArray(c)) {
        return c
          .map((p) => (typeof p === "string" ? p : "text" in p ? String(p.text ?? "") : ""))
          .join("")
          .trim();
      }
    }
  }
  return "";
}

/**
 * LangGraph Runtime — grafo oficial agent↔tools, desacoplado do WorkflowRuntimeOrchestrator.
 */
export class LangGraphRuntime implements AgentRuntime {
  readonly kind = "langgraph" as const;
  private state: AgentRuntimeState = { status: "idle", graphHistory: [] };
  private readonly invokeAgentLlm?: LangGraphRuntimeDeps["invokeAgentLlm"];
  private readonly invokeToolOverride?: LangGraphRuntimeDeps["invokeTool"];

  constructor(
    private readonly executor: NativeAgentExecutor,
    deps?: LangGraphRuntimeDeps,
  ) {
    void deps?.createMemoryProvider;
    this.invokeAgentLlm = deps?.invokeAgentLlm;
    this.invokeToolOverride = deps?.invokeTool;
  }

  executeStream(input: AgentRuntimeExecuteInput): AsyncGenerator<StreamRuntimeEvent> {
    return executeRuntimeStream(this, input);
  }

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    this.state = { status: "running", graphHistory: ["agent"], currentNode: "agent" };

    const traceBuilder = new ExecutionTraceBuilder({
      runtime: "langgraph",
      memory: input.engineConfig.memory,
      strictMode: input.engineConfig.strictMode,
      observability: input.engineConfig.observability,
    });
    traceBuilder.emitEvent("start", "LangGraph.js StateGraph agent↔tools");
    const spineMode = resolveUnifiedSpineMode(input.engineConfig);
    if (spineMode !== "off") {
      traceBuilder.emitEvent(
        "spine",
        `Unified spine (${spineMode}) — plan/contract via executor nativo`,
      );
    }

    const checkpointer = getAgentGraphCheckpointer(
      input.engineConfig.checkpointStore ?? "memory",
      input.organizationId,
    );
    const graph = this.buildGraph(checkpointer, input);
    const threadId = `${input.conversation.id}:${input.message.id}`;
    traceBuilder.setCheckpointThreadId(threadId);
    publishGraphEvent(threadId, {
      kind: "checkpoint",
      at: new Date().toISOString(),
      detail: "Thread checkpoint",
      metadata: { threadId },
    });

    const userText = (input.message.body ?? "").trim() || "(mensagem vazia)";
    const initialState: Partial<CrmGraphState> = {
      messages: [new HumanMessage(userText)],
      organizationId: input.organizationId,
      conversationId: input.conversation.id,
      botId: input.bot.id,
      reply: "",
      toolOutcomes: [],
      crmInput: input,
      agentRound: 0,
    };

    const config = { configurable: { thread_id: threadId } };
    let result: CrmGraphState;
    let interruptedForHitl = false;

    try {
      result = await Promise.race([
        graph.invoke(initialState, config) as Promise<CrmGraphState>,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("LangGraph execution timeout")), LANGGRAPH_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (isGraphInterrupt(err)) {
        interruptedForHitl = true;
        traceBuilder.emitEvent("hitl", "Grafo pausado — HITL interrupt");
        const pending = registerHitlPending({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          messageId: input.message.id,
          botId: input.bot.id,
          replyPreview: "",
          supervisorSummary: "HITL interrupt — approve tool calls",
          threadId,
          checkpointStore: input.engineConfig.checkpointStore ?? "memory",
          humanInTheLoopNative: true,
        });
        traceBuilder.setHitlPendingId(pending.id);
        await this.mirrorCheckpointSnapshot(
          input.organizationId,
          input.engineConfig.checkpointStore ?? "memory",
          graph,
          checkpointer,
          threadId,
        );
        this.state = { status: "idle", graphHistory: ["agent", "human_review"] };
        return { reply: "", trace: traceBuilder.build() };
      }
      traceBuilder.addError(err instanceof Error ? err.message : String(err));
      this.state = { status: "idle", graphHistory: ["agent"] };
      throw err;
    }

    void interruptedForHitl;

    const reply = (result.reply ?? "").trim() || extractFinalReply(result.messages ?? []);
    const toolOutcomes = result.toolOutcomes ?? [];

    traceBuilder.startNode("agent", "LangGraph agent");
    traceBuilder.endNode("agent", "ok", `rounds≈${result.agentRound ?? 0}`);
    if (toolOutcomes.length > 0) {
      traceBuilder.startNode("tools", "LangGraph tools");
      traceBuilder.endNode(
        "tools",
        "ok",
        toolOutcomes.map((t) => t.name).join(", ").slice(0, 200),
      );
    }
    traceBuilder.startNode("respond", "Map messages → CRM reply");
    traceBuilder.endNode("respond", "ok", reply ? `${reply.length} chars` : "empty");

    await this.mirrorCheckpointSnapshot(
      input.organizationId,
      input.engineConfig.checkpointStore ?? "memory",
      graph,
      checkpointer,
      threadId,
    );

    const trace = traceBuilder.build();
    if (isLangfuseConfigured()) {
      void ingestAgentTraceToLangfuse({
        organizationId: input.organizationId,
        conversationId: input.conversation.id,
        botId: input.bot.id,
        messageId: input.message.id,
        trace,
      }).catch(() => undefined);
    }
    void ingestAgentTraceToOtel(trace, {
      turnId: input.message.id,
      enabled: input.engineConfig.otelEnabled === true,
    }).catch(() => undefined);

    this.state = {
      status: "idle",
      graphHistory: toolOutcomes.length ? ["agent", "tools", "respond"] : ["agent", "respond"],
    };

    return { reply, toolOutcomes, trace };
  }

  static async readCheckpoint(
    organizationId: string,
    threadId: string,
    checkpointStore: AgentCheckpointStoreKind = "memory",
    executor: NativeAgentExecutor,
  ): Promise<GraphCheckpointSnapshot | null> {
    const runtime = new LangGraphRuntime(executor);
    const checkpointer = getAgentGraphCheckpointer(checkpointStore, organizationId);
    const graph = runtime.buildGraphForResume(checkpointStore, organizationId);
    return readGraphCheckpointSnapshotWithFallback(
      organizationId,
      checkpointStore,
      checkpointer,
      graph,
      threadId,
    );
  }

  buildGraphForResume(
    checkpointStore: AgentCheckpointStoreKind = "memory",
    organizationId = "default",
  ): ReturnType<LangGraphRuntime["buildGraph"]> {
    const checkpointer = getAgentGraphCheckpointer(checkpointStore, organizationId);
    const stubInput = {
      organizationId,
      engineConfig: {
        runtime: "langgraph" as const,
        memory: "openconduit" as const,
        supervisorEnabled: false,
        strictMode: false,
        observability: "basic" as const,
        humanInTheLoopEnabled: false,
      },
    } as AgentRuntimeExecuteInput;
    return this.buildGraph(checkpointer, stubInput);
  }

  /** Grafo compilado (testes / resume HITL). */
  buildGraph(
    checkpointer: ReturnType<typeof getAgentGraphCheckpointer>,
    crmTemplate: AgentRuntimeExecuteInput,
  ) {
    const runtime = this;
    const hitlEnabled = crmTemplate.engineConfig.humanInTheLoopEnabled === true;

    const agentNode = async (state: CrmGraphState): Promise<Partial<CrmGraphState>> => {
      const round = (state.agentRound ?? 0) + 1;
      if (round > MAX_TOOL_ROUNDS) {
        const reply = extractFinalReply(state.messages) || "Não consegui concluir com as ferramentas disponíveis.";
        return {
          messages: [new AIMessage(reply)],
          reply,
          agentRound: round,
        };
      }

      const crm = state.crmInput ?? crmTemplate;

      if (runtime.invokeAgentLlm) {
        const llm = await runtime.invokeAgentLlm({
          messages: state.messages,
          crm,
          round,
        });
        if (llm.toolCalls && llm.toolCalls.length > 0) {
          if (hitlEnabled) {
            const decision = interrupt({
              reason: "approve_tool_calls",
              tools: llm.toolCalls.map((t) => t.name),
            });
            if (decision === "rejected") {
              return {
                messages: [new AIMessage("Ação cancelada após revisão humana.")],
                reply: "Ação cancelada após revisão humana.",
                agentRound: round,
              };
            }
          }
          const ai = new AIMessage({
            content: llm.content || "",
            tool_calls: llm.toolCalls.map((t) => ({
              id: t.id,
              name: t.name,
              args: t.args,
              type: "tool_call" as const,
            })),
          });
          return { messages: [ai], agentRound: round };
        }
        const content = llm.content?.trim() || "";
        return {
          messages: [new AIMessage(content)],
          reply: content,
          agentRound: round,
        };
      }

      // Produção: loop linear nativo (sandbox) dentro do nó agent — sem orchestrator.
      const exec = await runtime.executor({
        ...crm,
        // Não forçar hybrid: respeitar engineConfig / hints do CRM.
      });
      const content = (exec.reply ?? "").trim();
      return {
        messages: [new AIMessage(content)],
        reply: content,
        toolOutcomes: exec.toolOutcomes ?? [],
        agentRound: round,
      };
    };

    const toolsNode = async (state: CrmGraphState): Promise<Partial<CrmGraphState>> => {
      const crm = state.crmInput ?? crmTemplate;
      const last = [...state.messages].reverse().find((m) => isAIMessage(m));
      if (!last || !isAIMessage(last) || !last.tool_calls?.length) {
        return {};
      }

      const outcomes: ToolOutcome[] = [];
      const toolMessages: ToolMessage[] = [];

      for (const tc of last.tool_calls) {
        const name = tc.name;
        const args =
          tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
            ? (tc.args as Record<string, unknown>)
            : {};
        let rawJson: string;
        if (runtime.invokeToolOverride) {
          rawJson = await runtime.invokeToolOverride(name, args, crm);
        } else {
          const { invokeSingleNativeAgentTool } = await import("../../agentNativeLlm.js");
          const invoked = await invokeSingleNativeAgentTool({
            organizationId: crm.organizationId,
            bot: crm.bot,
            conversation: crm.conversation,
            message: crm.message,
            log: crm.log,
            behaviorConfig: crm.behaviorConfig ?? {},
            toolName: name,
            args,
            userMessage: (crm.message.body ?? "").trim(),
            kbPrefetchAppendix: crm.kbPrefetchAppendix,
          });
          rawJson = invoked.rawJson;
        }

        const { parseToolCallOutcomeFromJson } = await import("../../agentNativeLlm.js");
        const parsed = parseToolCallOutcomeFromJson(name, rawJson);
        outcomes.push({
          name: parsed.name,
          ok: parsed.ok,
          preview: parsed.preview,
          structuredPayload: parsed.structuredPayload,
        });
        toolMessages.push(
          new ToolMessage({
            content: rawJson.slice(0, 12_000),
            tool_call_id: tc.id ?? `${name}-${Date.now()}`,
            name,
          }),
        );
      }

      return { messages: toolMessages, toolOutcomes: outcomes };
    };

    const routeAfterAgent = (state: CrmGraphState): "tools" | typeof END => {
      if (lastAiHasToolCalls(state.messages ?? [])) return "tools";
      return END;
    };

    return new StateGraph(CrmGraphAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolsNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", routeAfterAgent, {
        tools: "tools",
        [END]: END,
      })
      .addEdge("tools", "agent")
      .compile({ checkpointer });
  }

  private async mirrorCheckpointSnapshot(
    organizationId: string,
    storeKind: AgentCheckpointStoreKind,
    graph: ReturnType<LangGraphRuntime["buildGraph"]>,
    checkpointer: ReturnType<typeof getAgentGraphCheckpointer>,
    threadId: string,
  ): Promise<void> {
    const snap = await readGraphCheckpointSnapshot(checkpointer, graph, threadId);
    if (snap) {
      await persistGraphCheckpointSnapshot(organizationId, storeKind, snap);
    }
  }
}
