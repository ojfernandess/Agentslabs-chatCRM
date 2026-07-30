import { Annotation, END, START, StateGraph, Send, interrupt, isGraphInterrupt } from "@langchain/langgraph";
import type { AgentRuntime } from "./AgentRuntime.js";
import type {
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeState,
  AgentSupervisorTrace,
} from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider as defaultCreateMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import {
  runWorkflowGate,
  shouldRunWorkflowGate,
} from "../audit/applyWorkflowGate.js";
import { shouldUseReplyOnlyRetry } from "../validators/turnPolicyParser.js";
import { priorToolOutcomesFromSession, buildPersistedFlowSlots, applyConfirmationPhaseTransitions } from "../core/sessionToolOutcomes.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldBlockReplyAfterSupervisor,
  shouldRetryAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import { parseLinkedKnowledgeArticleIdsFromBehavior } from "../../knowledgeRetrieval.js";
import {
  mergeKbPrefetchAppendix,
  prefetchKnowledgeForArticle,
  type KbPrefetchResult,
} from "../knowledge/parallelKbPrefetch.js";
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
import { executeRuntimeStream } from "./StreamingRuntime.js";
import type { StreamRuntimeEvent } from "./StreamingRuntime.js";
import { publishGraphEvent } from "../observability/AgentGraphEventBus.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import {
  resolveEffectiveToolExecutionMode,
  runWorkflowRuntimeTurn,
} from "./WorkflowRuntimeOrchestrator.js";
import {
  advanceImplicitWorkflowPhase,
  materializeImplicitWorkflowRun,
  SESSION_WORKFLOW_PHASE_KEY,
} from "../continuation/implicitTurnWorkflow.js";
import type { AgentCheckpointStoreKind } from "../types.js";
import { resolveEilTurn, flowSlotsFromMemory } from "../eil/runtimeBridge.js";
import {
  blockReasonFromTurnContract,
  shouldBlockOutboundFromTurnContract,
} from "../core/executionContractGate.js";
import type { TurnContext } from "../core/types.js";
import { invokeScheduledTools } from "../scheduler/invokeScheduledTools.js";
import { planScheduledToolInvocations, shouldRunToolScheduler } from "../scheduler/TurnToolScheduler.js";
import {
  sharedExecutionEngine,
  timelineToInspectorEntries,
  type EngineTurnState,
} from "../engine/index.js";
import {
  decideResilienceAction,
  parseResilienceConfig,
  type ResilienceActionKind,
} from "../resilience/TurnResilience.js";
import type { EilSnapshot, ExecutionIntelligencePlan, FactStore } from "../eil/types.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import { runContinuationIfEnabled } from "../continuation/runContinuation.js";

export type LangGraphRuntimeDeps = {
  createMemoryProvider?: typeof defaultCreateMemoryProvider;
};

const LANGGRAPH_TIMEOUT_MS = 120_000;

type GraphState = {
  input: AgentRuntimeExecuteInput;
  memory: Record<string, unknown>;
  reply: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  kbMeta: { hasUsefulExcerpts: boolean; coversQuery: boolean };
  retryCount: number;
  previousReply: string;
  traceBuilder: ExecutionTraceBuilder;
  supervisorApproved: boolean;
  supervisorTrace?: AgentSupervisorTrace;
  validationBlockSend: boolean;
  blockReply: boolean;
  hitlPendingId?: string;
  intentHints: { kbQueryLikely: boolean };
  llmSupervisorApproved?: boolean | null;
  llmSupervisorSummary?: string;
  kbPrefetchResults: KbPrefetchResult[];
  kbPrefetchArticleId?: string;
  kbPrefetchAppendix?: string;
  eilPlan?: ExecutionIntelligencePlan;
  eilFacts: FactStore;
  eilSnapshot?: EilSnapshot;
  turnContext?: TurnContext;
  /** Estado da Execution Engine — plan/contract únicos por turno. */
  engineTurn?: EngineTurnState;
  scheduledToolOutcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  /** Contador de recovers determinísticos neste turno (Fase 4). */
  recoveryCount: number;
  /** Força schedule_tools a invocar pending mesmo sem schedulerEnabled. */
  forceMandatoryRecovery: boolean;
  /** Próximo destino após supervisor (resilience). */
  resilienceRoute?: "schedule_tools" | "execute_tool" | "update_memory" | "human_review";
};

const GraphStateAnnotation = Annotation.Root({
  input: Annotation<AgentRuntimeExecuteInput>,
  memory: Annotation<Record<string, unknown>>,
  reply: Annotation<string>,
  toolOutcomes: Annotation<Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>>,
  kbMeta: Annotation<{ hasUsefulExcerpts: boolean; coversQuery: boolean }>,
  retryCount: Annotation<number>,
  previousReply: Annotation<string>,
  traceBuilder: Annotation<ExecutionTraceBuilder>,
  supervisorApproved: Annotation<boolean>,
  supervisorTrace: Annotation<AgentSupervisorTrace | undefined>,
  validationBlockSend: Annotation<boolean>,
  blockReply: Annotation<boolean>,
  hitlPendingId: Annotation<string | undefined>,
  intentHints: Annotation<{ kbQueryLikely: boolean }>,
  llmSupervisorApproved: Annotation<boolean | null | undefined>,
  llmSupervisorSummary: Annotation<string | undefined>,
  kbPrefetchResults: Annotation<KbPrefetchResult[]>({
    reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  kbPrefetchArticleId: Annotation<string | undefined>,
  kbPrefetchAppendix: Annotation<string | undefined>,
  eilPlan: Annotation<ExecutionIntelligencePlan | undefined>,
  eilFacts: Annotation<FactStore>,
  eilSnapshot: Annotation<EilSnapshot | undefined>,
  turnContext: Annotation<TurnContext | undefined>,
  engineTurn: Annotation<EngineTurnState | undefined>,
  scheduledToolOutcomes: Annotation<
    Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>
  >,
  recoveryCount: Annotation<number>,
  forceMandatoryRecovery: Annotation<boolean>,
  resilienceRoute: Annotation<"schedule_tools" | "execute_tool" | "update_memory" | "human_review" | undefined>,
});

/**
 * LangGraph Runtime — orquestra o fluxo via StateGraph sem expor LangGraph ao resto do CRM.
 */
export class LangGraphRuntime implements AgentRuntime {
  readonly kind = "langgraph" as const;
  private state: AgentRuntimeState = { status: "idle", graphHistory: [] };
  private readonly memoryFactory: typeof defaultCreateMemoryProvider;

  constructor(
    private readonly executor: NativeAgentExecutor,
    deps?: LangGraphRuntimeDeps,
  ) {
    this.memoryFactory = deps?.createMemoryProvider ?? defaultCreateMemoryProvider;
  }

  executeStream(input: AgentRuntimeExecuteInput): AsyncGenerator<StreamRuntimeEvent> {
    return executeRuntimeStream(this, input);
  }

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    if (input.engineConfig.workflowRuntimeShared === true) {
      this.state = { status: "running", graphHistory: ["workflow_runtime_shared"], currentNode: "orchestrator" };
      const result = await runWorkflowRuntimeTurn(input, this.executor, {
        runtimeLabel: "langgraph",
        createMemoryProvider: this.memoryFactory,
      });
      this.state = { status: "idle", graphHistory: ["workflow_runtime_shared"], currentNode: undefined };
      return result;
    }

    this.state = { status: "running", graphHistory: [], currentNode: "classify_intent" };

    const traceBuilder = new ExecutionTraceBuilder({
      runtime: "langgraph",
      memory: input.engineConfig.memory,
      strictMode: input.engineConfig.strictMode,
      observability: input.engineConfig.observability,
    });
    traceBuilder.emitEvent("start", "LangGraph execution started");

    const checkpointer = getAgentGraphCheckpointer(
      input.engineConfig.checkpointStore ?? "memory",
      input.organizationId,
    );
    const graph = this.buildGraph(checkpointer);
    const threadId = `${input.conversation.id}:${input.message.id}`;
    traceBuilder.setCheckpointThreadId(threadId);
    traceBuilder.emitEvent("checkpoint", "Thread checkpoint", { metadata: { threadId } });
    publishGraphEvent(threadId, {
      kind: "checkpoint",
      at: new Date().toISOString(),
      detail: "Thread checkpoint",
      metadata: { threadId },
    });

    const checkpointStore = input.engineConfig.checkpointStore ?? "memory";
    const initialState: GraphState = {
      input,
      memory: {},
      reply: "",
      toolOutcomes: [],
      kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
      retryCount: 0,
      previousReply: "",
      traceBuilder,
      supervisorApproved: false,
      validationBlockSend: false,
      blockReply: false,
      intentHints: { kbQueryLikely: false },
      kbPrefetchResults: [],
      eilFacts: {},
      scheduledToolOutcomes: [],
      recoveryCount: 0,
      forceMandatoryRecovery: false,
    };

    const config = { configurable: { thread_id: threadId } };
    const useStream = input.engineConfig.streamingEnabled === true;

    let result: GraphState;
    let interruptedForHitl = false;
    try {
      result = await Promise.race([
        useStream
          ? this.runGraphStream(graph, initialState, config, input, traceBuilder, threadId)
          : graph.invoke(initialState, config),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("LangGraph execution timeout")), LANGGRAPH_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (isGraphInterrupt(err)) {
        interruptedForHitl = true;
        traceBuilder.emitEvent("hitl", "Grafo pausado — aguarda aprovação humana (interrupt nativo)");
        publishGraphEvent(threadId, {
          kind: "hitl",
          at: new Date().toISOString(),
          detail: "Grafo pausado — interrupt nativo",
        });
        const pausedSnap = (await graph.getState(config)) as {
          values?: Partial<GraphState>;
        };
        result = {
          ...initialState,
          ...pausedSnap.values,
          traceBuilder,
        } as GraphState;
      } else {
        this.state = { status: "failed", graphHistory: [], checkpointId: threadId };
        traceBuilder.emitEvent("error", err instanceof Error ? err.message : "LangGraph execution failed");
        traceBuilder.addError(err instanceof Error ? err.message : "LangGraph execution failed");
        input.executionLog?.error(
          { id: "agent_engine", name: "LangGraph Runtime" },
          err instanceof Error ? err.message : "LangGraph execution failed",
        );
        return { reply: "", trace: traceBuilder.build() };
      }
    }

    void this.mirrorCheckpointSnapshot(
      input.organizationId,
      checkpointStore,
      graph,
      checkpointer,
      threadId,
    );

    traceBuilder.emitEvent("end", interruptedForHitl
      ? "LangGraph pausado em HITL"
      : "LangGraph execution completed");

    this.state = {
      status: interruptedForHitl ? "paused" : "completed",
      graphHistory: interruptedForHitl
        ? [
            "classify_intent",
            "load_memory",
            "schedule_tools",
            "execute_tool",
            "validate_result",
            "supervisor",
            "human_review",
          ]
        : [
            "classify_intent",
            "load_memory",
            "schedule_tools",
            "execute_tool",
            "validate_result",
            "supervisor",
            "update_memory",
            "respond",
          ],
      checkpointId: threadId,
    };

    if (result.turnContext) {
      const tc = result.turnContext;
      const ec = tc.executionContract;
      result.traceBuilder.setTurnSnapshot({
        version: tc.version,
        userMessage: tc.userMessage,
        intentKind: tc.intent.kind,
        intentConfidence: tc.intent.confidence,
        promptHash: tc.promptContract.promptHash,
        objective: tc.promptContract.objective || ec.objective,
        requiredToolNames: ec.requiredToolNames,
        pendingToolNames: ec.pendingToolNames,
        satisfiedToolNames: ec.satisfiedToolNames,
        forbiddenToolNames: ec.forbiddenToolNames,
        planPhase: ec.planPhase,
        contractValid: ec.valid,
        violations: ec.violations,
        eilEnabled: tc.eilEnabled,
      });
    }

    const trace = result.traceBuilder.build();
    if (result.supervisorTrace) trace.supervisor = result.supervisorTrace;
    if (result.hitlPendingId) trace.hitlPendingId = result.hitlPendingId;

    input.executionLog?.info(
      { id: "agent_engine", name: "LangGraph Runtime" },
      JSON.stringify({
        runtime: "langgraph",
        nodes: trace.nodes.length,
        supervisorApproved: result.supervisorApproved,
        retries: result.retryCount,
        blockReply: result.blockReply,
        turn: trace.turn
          ? {
              intent: trace.turn.intentKind,
              contractValid: trace.turn.contractValid,
              pending: trace.turn.pendingToolNames,
            }
          : undefined,
      }),
    );

    // Sempre registar turn/contract para MCP (mesmo sem observability full)
    if (trace.turn) {
      input.executionLog?.info(
        { id: "turn_context", name: "Turn Context" },
        JSON.stringify({ turn: trace.turn }),
      );
    }

    if (input.engineConfig.observability === "full") {
      input.executionLog?.info(
        { id: "agent_engine_trace", name: "LangGraph Trace" },
        JSON.stringify(trace),
      );
    }

    if (isLangfuseConfigured() && trace) {
      void ingestAgentTraceToLangfuse({
        trace,
        organizationId: input.organizationId,
        conversationId: input.conversation.id,
        botId: input.bot.id,
        messageId: input.message.id,
        traceId: threadId,
      }).then((r) => {
        if (r.ok) {
          input.executionLog?.info(
            { id: "langfuse", name: "Langfuse" },
            JSON.stringify({ traceId: r.traceId, exported: true }),
          );
        } else if (r.error && r.error !== "langfuse_not_configured") {
          input.executionLog?.warn(
            { id: "langfuse", name: "Langfuse" },
            r.error,
          );
        }
      });
    }

    if (input.engineConfig.otelEnabled && trace) {
      void ingestAgentTraceToOtel(trace, {
        enabled: true,
        turnId: threadId,
      }).then((r) => {
        input.executionLog?.info(
          { id: "otel", name: "OpenTelemetry" },
          JSON.stringify({
            spanCount: r.spanCount,
            exported: r.exported,
            endpoint: r.endpoint,
            error: r.error,
          }),
        );
      });
    }

    return {
      reply: result.blockReply ? "" : result.reply,
      trace,
      toolOutcomes: result.toolOutcomes,
    };
  }

  /** Lê snapshot de checkpoint LangGraph (memória + mirror Redis quando configurado). */
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

  /** Expõe grafo compilado para resume HITL via `Command`. */
  buildGraphForResume(
    checkpointStore: AgentCheckpointStoreKind = "memory",
    organizationId = "default",
  ): ReturnType<LangGraphRuntime["buildGraph"]> {
    const checkpointer = getAgentGraphCheckpointer(checkpointStore, organizationId);
    return this.buildGraph(checkpointer);
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

  private async runGraphStream(
    graph: ReturnType<LangGraphRuntime["buildGraph"]>,
    initialState: GraphState,
    config: { configurable: { thread_id: string } },
    input: AgentRuntimeExecuteInput,
    traceBuilder: ExecutionTraceBuilder,
    threadId: string,
  ): Promise<GraphState> {
    traceBuilder.emitEvent("stream", "LangGraph stream started");
    publishGraphEvent(threadId, {
      kind: "stream",
      at: new Date().toISOString(),
      detail: "LangGraph stream started",
    });
    let merged: GraphState = { ...initialState };
    const stream = await graph.stream(initialState, config);
    for await (const chunk of stream) {
      for (const [nodeId, update] of Object.entries(chunk)) {
        traceBuilder.emitEvent("node", "stream chunk", { nodeId, metadata: { streaming: true } });
        publishGraphEvent(threadId, {
          kind: "node",
          at: new Date().toISOString(),
          nodeId,
          detail: "stream chunk",
          metadata: { streaming: true },
        });
        merged = { ...merged, ...(update as Partial<GraphState>) };
        input.executionLog?.info(
          { id: "langgraph_stream", name: `Stream: ${nodeId}` },
          JSON.stringify({ nodeId, threadId: config.configurable.thread_id }),
        );
      }
    }
    traceBuilder.emitEvent("stream", "LangGraph stream completed");
    publishGraphEvent(threadId, {
      kind: "stream",
      at: new Date().toISOString(),
      detail: "LangGraph stream completed",
    });
    return merged;
  }

  private buildGraph(checkpointer: ReturnType<typeof getAgentGraphCheckpointer>) {
    const executor = this.executor;

    const classifyIntent = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("classify_intent", "Classificar intenção");
      const userMessage = state.input.message.body ?? "";
      const kbQueryLikely = userMessageLooksLikeKnowledgeSeekingQuery(userMessage);
      state.traceBuilder.setNextNode("fan_out_kb");
      state.traceBuilder.endNode(
        "classify_intent",
        "ok",
        kbQueryLikely ? "consulta_kb provável" : "geral",
      );
      return { intentHints: { kbQueryLikely } };
    };

    const kbReadNode = async (state: GraphState): Promise<Partial<GraphState>> => {
      const articleId = state.kbPrefetchArticleId;
      if (!articleId) return {};
      state.traceBuilder.startNode("kb_read_node", `KB prefetch ${articleId.slice(0, 8)}`);
      const userMessage = (state.input.message.body ?? "").trim().toLowerCase().slice(0, 500);
      const result = await prefetchKnowledgeForArticle({
        organizationId: state.input.organizationId,
        botId: state.input.bot.id,
        articleId,
        normalizedQuery: userMessage,
        log: state.input.log,
      });
      state.traceBuilder.endNode(
        "kb_read_node",
        result ? "ok" : "skipped",
        result ? result.title : "artigo não encontrado",
      );
      if (!result) return {};
      publishGraphEvent(`${state.input.conversation.id}:${state.input.message.id}`, {
        kind: "knowledge",
        at: new Date().toISOString(),
        detail: `KB prefetch: ${result.title}`,
        metadata: { articleId: result.articleId, excerpts: result.ranked.length },
      });
      return { kbPrefetchResults: [result] };
    };

    const mergeKbResults = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("merge_kb_results", "Agregar prefetch KB");
      const appendix = mergeKbPrefetchAppendix(state.kbPrefetchResults);
      state.traceBuilder.setNextNode("load_memory");
      state.traceBuilder.endNode(
        "merge_kb_results",
        appendix ? "ok" : "skipped",
        appendix ? `${state.kbPrefetchResults.length} artigo(s)` : "sem excertos",
      );
      state.input.executionLog?.info(
        { id: "parallel_kb_prefetch", name: "Parallel KB Prefetch" },
        JSON.stringify({
          articles: state.kbPrefetchResults.length,
          appendixChars: appendix.length,
        }),
      );
      return { kbPrefetchAppendix: appendix || undefined };
    };

    const routeAfterClassify = (state: GraphState): "load_memory" | Send[] => {
      const prefetchEnabled = state.input.engineConfig.parallelKbPrefetchEnabled === true;
      const pinned = parseLinkedKnowledgeArticleIdsFromBehavior(state.input.behaviorConfig);
      if (!prefetchEnabled || !state.intentHints.kbQueryLikely || pinned.length === 0) {
        return "load_memory";
      }
      state.traceBuilder.emitEvent("edge", "Fan-out KB prefetch (Send API)", {
        metadata: { articles: pinned.slice(0, 3) },
      });
      return pinned.slice(0, 3).map(
        (articleId) => new Send("kb_read_node", { kbPrefetchArticleId: articleId }),
      );
    };

    const loadMemory = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("load_memory", "Carregar memória");
      const provider = this.memoryFactory(state.input.engineConfig.memory);
      const memory = await provider.load(
        state.input.conversation.id,
        state.input.organizationId,
      );
      state.traceBuilder.setMemorySnapshot(memory);
      const engineTurn0 = sharedExecutionEngine.beginTurn({
        input: state.input,
        memory,
      });
      let engineTurn = engineTurn0;
      const continuation = await runContinuationIfEnabled({
        engineConfig: state.input.engineConfig,
        behaviorConfig: state.input.behaviorConfig as Record<string, unknown>,
        organizationId: state.input.organizationId,
        conversationId: state.input.conversation.id,
        userMessage: state.input.message.body ?? "",
        vars: {
          facts: engineTurn.turnContext.facts,
          flowSlots: flowSlotsFromMemory(memory),
        },
      });
      let workflowImplicit = false;
      if (continuation.enabled && continuation.state) {
        engineTurn = sharedExecutionEngine.attachWorkflow(engineTurn, continuation.state);
      } else {
        workflowImplicit = true;
        const implicit = materializeImplicitWorkflowRun({
          organizationId: state.input.organizationId,
          conversationId: state.input.conversation.id,
          messageId: state.input.message.id,
          requiredToolNames: engineTurn.plan.requiredToolNames,
          userMessage: state.input.message.body ?? "",
        });
        engineTurn = sharedExecutionEngine.attachWorkflow(engineTurn, implicit.state);
      }
      engineTurn = sharedExecutionEngine.replanWithWorkflow(engineTurn, state.input.behaviorConfig, {
        memory,
      });
      engineTurn = sharedExecutionEngine.recordPhase(
        engineTurn,
        "workflow",
        `${engineTurn.workflowRun?.status}:${engineTurn.workflowRun?.currentStepId ?? "done"}`,
        {
          implicit: workflowImplicit,
          resumed: continuation.resumed,
          plannedTools: engineTurn.workflowRun?.plannedToolNames,
          suspendReason: engineTurn.workflowRun?.suspendReason,
        },
      );
      state.traceBuilder.emitEvent("workflow_engine", "Workflow controls turn", {
        metadata: {
          implicit: workflowImplicit,
          status: engineTurn.workflowRun?.status,
          resumed: continuation.resumed,
          plannedTools: engineTurn.workflowRun?.plannedToolNames,
          requiredAfterMerge: engineTurn.plan.requiredToolNames,
        },
      });
      if (engineTurn.workflowRun && workflowImplicit) {
        engineTurn = sharedExecutionEngine.attachWorkflow(
          engineTurn,
          advanceImplicitWorkflowPhase(engineTurn.workflowRun, "schedule_required"),
        );
      }
      const turnContext = engineTurn.turnContext;
      state.traceBuilder.emitEvent("turn_context", "ExecutionEngine beginTurn", {
        metadata: {
          intent: turnContext.intent.kind,
          requiredTools: turnContext.executionContract.requiredToolNames,
          contractValid: turnContext.executionContract.valid,
          promptHash: turnContext.promptContract.promptHash,
        },
      });
      state.traceBuilder.setNextNode("schedule_tools");
      state.traceBuilder.endNode("load_memory");
      return {
        memory,
        eilFacts: turnContext.facts,
        eilPlan: turnContext.eilPlan,
        eilSnapshot: turnContext.eilSnapshot,
        turnContext,
        engineTurn,
        intentHints: { kbQueryLikely: turnContext.intent.kind === "knowledge_query" },
      };
    };

    const scheduleTools = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("schedule_tools", "Tool Scheduler");
      const userMessage = state.input.message.body ?? "";
      let engineTurn = state.engineTurn;
      let turnContext = state.turnContext ?? engineTurn?.turnContext;
      let scheduledToolOutcomes = state.scheduledToolOutcomes ?? [];
      let toolOutcomes = state.toolOutcomes;
      const forceRecovery = state.forceMandatoryRecovery === true;
      let recoveryCount = state.recoveryCount ?? 0;

      const canSchedule =
        forceRecovery ||
        shouldRunToolScheduler(state.input.engineConfig, state.input.executionHints);

      if (canSchedule && turnContext) {
        const plan = planScheduledToolInvocations(turnContext, toolOutcomes);
        if (plan.length > 0) {
          const scheduled = await invokeScheduledTools({
            organizationId: state.input.organizationId,
            bot: state.input.bot,
            conversation: state.input.conversation,
            message: state.input.message,
            log: state.input.log,
            behaviorConfig: state.input.behaviorConfig,
            turnContext,
            existingOutcomes: toolOutcomes,
            userMessage,
            kbPrefetchAppendix: state.kbPrefetchAppendix,
          });
          scheduledToolOutcomes = scheduled.outcomes.map(({ name, ok, preview, structuredPayload }) => ({
            name,
            ok,
            preview,
            structuredPayload,
          }));
          toolOutcomes = [
            ...toolOutcomes,
            ...scheduledToolOutcomes.filter(
              (t) => !toolOutcomes.some((p) => p.name === t.name && p.ok),
            ),
          ];
          if (engineTurn) {
            engineTurn = sharedExecutionEngine.refreshTurnWithBehavior(
              engineTurn,
              state.input.behaviorConfig,
              {
                toolOutcomes,
                memory: state.memory,
                priorFacts: state.eilFacts,
                phase: forceRecovery ? "recover" : "schedule",
              },
            );
            if (forceRecovery) {
              engineTurn = sharedExecutionEngine.bumpRecovery(engineTurn);
              recoveryCount = engineTurn.recoveryCount;
            }
            turnContext = engineTurn.turnContext;
          }
          if (forceRecovery && !engineTurn) recoveryCount += 1;
          state.traceBuilder.emitEvent(
            "turn_context",
            forceRecovery
              ? "Mandatory tool recovery executou tools"
              : "Tool Scheduler executou tools obrigatórias",
            {
              metadata: {
                scheduled: scheduled.invocations.map((i) => i.toolName),
                outcomes: scheduledToolOutcomes.map((o) => ({ name: o.name, ok: o.ok })),
                forceRecovery,
                recoveryCount,
              },
            },
          );
          state.input.executionLog?.info(
            { id: forceRecovery ? "tool_recovery" : "tool_scheduler", name: forceRecovery ? "Tool Recovery" : "Tool Scheduler" },
            JSON.stringify({
              planned: plan.map((p) => p.toolName),
              executed: scheduledToolOutcomes.map((o) => o.name),
              recoveryCount,
            }),
          );
        }
      }

      state.traceBuilder.setNextNode("execute_tool");
      state.traceBuilder.endNode(
        "schedule_tools",
        "ok",
        scheduledToolOutcomes.length > 0
          ? `${scheduledToolOutcomes.length} tool(s) pré-executada(s)${forceRecovery ? " · recovery" : ""}`
          : "nenhuma tool obrigatória pendente",
      );
      return {
        turnContext,
        engineTurn,
        toolOutcomes,
        scheduledToolOutcomes,
        eilPlan: turnContext?.eilPlan ?? state.eilPlan,
        eilFacts: turnContext?.facts ?? state.eilFacts,
        eilSnapshot: turnContext?.eilSnapshot ?? state.eilSnapshot,
        recoveryCount,
        forceMandatoryRecovery: false,
      };
    };

    const executeTool = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
      const toolMode = resolveEffectiveToolExecutionMode(state.input);
      const replyOnly =
        (state.retryCount > 0 &&
          shouldUseReplyOnlyRetry({
            toolOutcomes: state.toolOutcomes,
            supervisorChecks: state.supervisorTrace?.checks,
          })) ||
        (toolMode === "runtime_owned" && (state.scheduledToolOutcomes?.length ?? 0) > 0);
      const priorOk = state.toolOutcomes.filter((t) => t.ok);
      const preScheduled = state.scheduledToolOutcomes ?? [];
      const execResult = await executor({
        ...state.input,
        kbPrefetchAppendix: state.kbPrefetchAppendix,
        executionHints: {
          ...state.input.executionHints,
          toolExecutionMode: toolMode,
          ...(replyOnly
            ? {
                replyOnlyRetry: true,
                priorSuccessfulToolOutcomes: priorOk,
              }
            : {}),
          ...(preScheduled.length > 0
            ? {
                preScheduledToolOutcomes: preScheduled.map(
                  ({ name, ok, preview, structuredPayload }) => ({
                    name,
                    ok,
                    preview,
                    structuredPayload,
                  }),
                ),
              }
            : {}),
        },
      });
      state.traceBuilder.setNextNode("validate_result");
      state.traceBuilder.endNode(
        "execute_tool",
        "ok",
        replyOnly ? "reply-only retry (sem reexecutar tools mutáveis)" : undefined,
      );
      const nextOutcomes =
        toolMode === "runtime_owned"
          ? [...state.toolOutcomes]
          : replyOnly && priorOk.length > 0
            ? [
                ...priorOk,
                ...(execResult.toolOutcomes ?? []).filter(
                  (t) => !priorOk.some((p) => p.name === t.name && p.ok),
                ),
              ]
            : [
                ...state.toolOutcomes,
                ...(execResult.toolOutcomes ?? []).filter(
                  (t) => !state.toolOutcomes.some((p) => p.name === t.name && p.ok),
                ),
              ];
      const eil = resolveEilTurn({
        behaviorConfig: state.input.behaviorConfig,
        userMessage: state.input.message.body ?? "",
        memory: state.memory,
        toolOutcomes: nextOutcomes,
        replyText: execResult.reply,
        priorFacts: state.eilFacts,
        freezeCompletionPromotion: state.engineTurn?.freezeCompletionPromotion,
        postCompletionFollowUp: state.engineTurn?.postCompletionFollowUp,
      });
      return {
        previousReply: state.reply,
        reply: execResult.reply,
        toolOutcomes: nextOutcomes,
        kbMeta: execResult.kbMeta ?? { hasUsefulExcerpts: false, coversQuery: false },
        llmSupervisorApproved: execResult.llmSupervisorApproved,
        llmSupervisorSummary: execResult.llmSupervisorSummary,
        eilPlan: eil.plan,
        eilFacts: eil.facts,
        eilSnapshot: eil.snapshot,
      };
    };

    const validateResult = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("validate_result", "Validar resultado");
      const userMessage = state.input.message.body ?? "";
      let engineTurn = state.engineTurn;
      if (engineTurn) {
        engineTurn = sharedExecutionEngine.refreshTurnWithBehavior(
          engineTurn,
          state.input.behaviorConfig,
          {
            toolOutcomes: state.toolOutcomes,
            memory: state.memory,
            priorFacts: state.eilFacts,
            phase: "validate",
          },
        );
      }
      const turnContext = engineTurn?.turnContext ?? state.turnContext;
      const contract = turnContext?.executionContract;
      const requiredToolNames = contract?.requiredToolNames ?? [];
      const turnPolicy = turnContext?.promptContract.turnPolicy ?? {
        forbiddenSameTurnPairs: [],
        exclusiveAllowedTools: null,
        completionToolHints: [],
        confirmationPrerequisiteTools: [],
        omitToolsWhenSlotsPresent: [],
        blockEscalation: false,
      };
      const validation = validateToolExecution({
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        strictMode: state.input.engineConfig.strictMode,
        requiredToolNames,
        turnPolicy,
        behaviorConfig: turnContext ? undefined : state.input.behaviorConfig,
        userMessage,
        capabilityGraph: turnContext?.capabilityGraph ?? state.engineTurn?.turnContext.capabilityGraph,
        factsBeforeTurn: state.eilFacts ?? turnContext?.facts,
      });
      if (!validation.ok) {
        for (const a of validation.alerts) state.traceBuilder.addError(a);
        state.input.executionLog?.warn(
          { id: "tool_validator", name: "Tool Validator" },
          validation.alerts.join("; "),
        );
        try {
          const reverted = await maybeRevertIllegalHandoffAfterValidation({
            organizationId: state.input.organizationId,
            conversationId: state.input.conversation.id,
            toolOutcomes: state.toolOutcomes,
            validationAlerts: validation.alerts,
            turnPolicy,
          });
          if (reverted) {
            state.input.executionLog?.info(
              { id: "handoff_revert", name: "Handoff revert" },
              "Handoff ilegal revertido após validação de turno",
            );
          }
        } catch {
          /* best-effort */
        }
      }
      state.traceBuilder.setNextNode("supervisor");
      state.traceBuilder.endNode(
        "validate_result",
        validation.blockSend && state.input.engineConfig.strictMode ? "error" : "ok",
      );
      return {
        validationBlockSend: validation.blockSend,
        eilPlan: turnContext?.eilPlan ?? state.eilPlan,
        eilFacts: turnContext?.facts ?? state.eilFacts,
        eilSnapshot: turnContext?.eilSnapshot ?? state.eilSnapshot,
        turnContext,
        engineTurn,
      };
    };

    const outboundContractGate = (
      state: GraphState,
      opts: { canRetry: boolean; supervisorTrace?: AgentSupervisorTrace },
    ): boolean =>
      shouldBlockOutboundFromTurnContract({
        strictMode: state.input.engineConfig.strictMode,
        validationBlockSend: state.validationBlockSend,
        supervisorTrace: opts.supervisorTrace ?? state.supervisorTrace,
        retryCount: state.retryCount,
        canRetry: opts.canRetry,
        executionContract: state.turnContext?.executionContract,
        toolOutcomes: state.toolOutcomes,
        recoverFirst:
          state.input.engineConfig.resilienceEnabled === true ||
          state.input.engineConfig.workflowRuntimeShared === true,
      });

    const supervisor = async (state: GraphState): Promise<Partial<GraphState>> => {
      if (!state.input.engineConfig.supervisorEnabled) {
        const blockReply =
          outboundContractGate(state, { canRetry: false }) || state.blockReply;
        return {
          supervisorApproved: !blockReply,
          blockReply,
        };
      }

      const mode = state.input.engineConfig.supervisorMode ?? "both";
      state.traceBuilder.startNode("supervisor", "Supervisor IA");

      if (mode === "llm") {
        const approved = state.llmSupervisorApproved !== false;
        const summary = state.llmSupervisorSummary ?? (approved ? "LLM supervisor aprovou" : "LLM supervisor reprovou");
        const supTrace = {
          approved,
          summary,
          checks: [{ id: "llm_supervisor", label: "Supervisor IA (LLM)", passed: approved, detail: summary }],
          retryCount: state.retryCount,
        };
        const blockReply =
          outboundContractGate(state, { canRetry: false, supervisorTrace: supTrace }) ||
          state.blockReply;
        state.traceBuilder.emitEvent("supervisor", summary, { metadata: { mode: "llm", approved } });
        state.traceBuilder.setNextNode("update_memory");
        state.traceBuilder.endNode("supervisor", approved ? "ok" : "warn", summary);
        return { supervisorApproved: approved && !blockReply, supervisorTrace: supTrace, blockReply };
      }

      const turnPolicy = state.turnContext?.promptContract.turnPolicy;
      const supInput = buildSupervisorValidationInput({
        userMessage: state.input.message.body ?? "",
        replyText: state.reply,
        toolOutcomes: state.toolOutcomes,
        kbMeta: state.kbMeta,
        strictMode: state.input.engineConfig.strictMode,
        memorySnapshot: state.memory,
        retryCount: state.retryCount,
        previousReply: state.previousReply,
        llmApproved: mode === "both" ? state.llmSupervisorApproved : undefined,
        llmSummary: mode === "both" ? state.llmSupervisorSummary : undefined,
        validationBlockSend: state.validationBlockSend,
        kbQueryLikely: state.intentHints.kbQueryLikely,
        eilEnabled: state.eilSnapshot?.enabled === true,
        eilPlan: state.eilPlan,
        eilViolations: state.eilSnapshot?.violations,
        eilRequiredFactsMissing: state.eilPlan?.pendingFacts,
        turnPolicy,
        executionContract: state.turnContext?.executionContract ?? null,
      });
      const supTrace = buildSupervisorTrace(supInput);

      const retry = shouldRetryAfterSupervisor(
        supTrace,
        state.input.engineConfig.strictMode,
        state.retryCount,
      );

      const resilienceCfg = parseResilienceConfig(
        state.input.engineConfig,
        state.input.behaviorConfig,
      );
      const resilience =
        state.engineTurn != null
          ? sharedExecutionEngine.decideRecovery({
              engineConfig: state.input.engineConfig,
              behaviorConfig: state.input.behaviorConfig,
              supervisorTrace: supTrace,
              executionContract: state.turnContext?.executionContract ?? null,
              retryCount: state.retryCount,
              recoveryCount: state.recoveryCount ?? 0,
              previousReply: state.previousReply,
              replyText: state.reply,
              toolOutcomes: state.toolOutcomes,
            })
          : decideResilienceAction({
              config: resilienceCfg,
              strictMode: state.input.engineConfig.strictMode,
              supervisorTrace: supTrace,
              executionContract: state.turnContext?.executionContract ?? null,
              retryCount: state.retryCount,
              recoveryCount: state.recoveryCount ?? 0,
              previousReply: state.previousReply,
              replyText: state.reply,
              toolOutcomes: state.toolOutcomes,
            });

      let resilienceRoute: GraphState["resilienceRoute"] = undefined;
      let forceMandatoryRecovery = false;
      let nextReply = state.reply;
      let nextBlockReply =
        outboundContractGate(state, { canRetry: retry, supervisorTrace: supTrace }) ||
        shouldBlockReplyAfterSupervisor(
          supTrace,
          state.input.engineConfig.strictMode,
          state.retryCount,
        ) ||
        state.blockReply;
      let nextRetryCount = state.retryCount;
      let nextSupervisorApproved = supTrace.approved;

      if (resilienceCfg.enabled && !supTrace.approved) {
        const action: ResilienceActionKind = resilience.action;
        if (action === "recover_mandatory_tools") {
          resilienceRoute = "schedule_tools";
          forceMandatoryRecovery = true;
          nextBlockReply = false;
          nextRetryCount = state.retryCount + 1;
          state.traceBuilder.emitEvent("retry", "Mandatory tool recovery", {
            nodeId: "schedule_tools",
            metadata: {
              pending: resilience.pendingToolNames,
              reason: resilience.reason,
            },
          });
        } else if (action === "reply_only_retry") {
          resilienceRoute = "execute_tool";
          nextBlockReply = false;
          nextRetryCount = state.retryCount + 1;
          state.traceBuilder.emitEvent("retry", "Reply-only resilience retry", {
            nodeId: "execute_tool",
            metadata: { reason: resilience.reason },
          });
        } else if (action === "apply_fallback") {
          resilienceRoute = "update_memory";
          nextReply = resilience.fallbackMessage ?? resilienceCfg.blockedFallbackMessage;
          nextBlockReply = false;
          nextSupervisorApproved = true;
          state.traceBuilder.emitEvent("supervisor", "Smart fallback aplicado", {
            metadata: { reason: resilience.reason },
          });
        } else if (action === "block") {
          resilienceRoute = "update_memory";
          nextBlockReply = true;
        } else if (retry) {
          resilienceRoute = "execute_tool";
          nextRetryCount = state.retryCount + 1;
          nextBlockReply = false;
          state.traceBuilder.emitEvent("retry", "Supervisor solicitou nova execução", {
            nodeId: "execute_tool",
            metadata: { retryCount: nextRetryCount },
          });
        } else {
          resilienceRoute = "update_memory";
        }
      } else if (retry) {
        resilienceRoute = "execute_tool";
        nextRetryCount = state.retryCount + 1;
        nextBlockReply = false;
        state.traceBuilder.emitEvent("retry", "Supervisor solicitou nova execução", {
          nodeId: "execute_tool",
          metadata: { retryCount: nextRetryCount },
        });
      }

      let hitlPendingId = state.hitlPendingId;
      const hitlEnabled = state.input.engineConfig.humanInTheLoopEnabled === true;
      const hitlNative = state.input.engineConfig.humanInTheLoopNativeEnabled === true;
      const checkpointStore = state.input.engineConfig.checkpointStore ?? "memory";
      const threadId = `${state.input.conversation.id}:${state.input.message.id}`;
      const isResilienceRetry =
        resilienceRoute === "schedule_tools" || resilienceRoute === "execute_tool";
      if (
        hitlEnabled &&
        !nextSupervisorApproved &&
        !isResilienceRetry &&
        nextReply.trim() &&
        (nextBlockReply || state.input.engineConfig.strictMode)
      ) {
        const pending = registerHitlPending({
          organizationId: state.input.organizationId,
          conversationId: state.input.conversation.id,
          messageId: state.input.message.id,
          botId: state.input.bot.id,
          replyPreview: nextReply,
          supervisorSummary: supTrace.summary,
          threadId,
          checkpointStore,
          humanInTheLoopNative: hitlNative,
        });
        hitlPendingId = pending.id;
        state.traceBuilder.setHitlPendingId(pending.id);
        state.traceBuilder.emitEvent("hitl", "Resposta pendente de aprovação humana", {
          metadata: { hitlId: pending.id },
        });
        state.input.executionLog?.info(
          { id: "langgraph_hitl", name: "Human-in-the-Loop" },
          JSON.stringify({ hitlId: pending.id, conversationId: state.input.conversation.id }),
        );
      }

      state.traceBuilder.emitEvent("supervisor", supTrace.summary, {
        metadata: {
          approved: nextSupervisorApproved,
          checks: supTrace.checks.length,
          resilience: resilience.action,
          resilienceReason: resilience.reason,
        },
      });

      const nextNode =
        resilienceRoute === "schedule_tools"
          ? "schedule_tools"
          : resilienceRoute === "execute_tool"
            ? "execute_tool"
            : "update_memory";
      state.traceBuilder.setNextNode(nextNode);
      state.traceBuilder.endNode(
        "supervisor",
        nextSupervisorApproved ? "ok" : "warn",
        resilienceCfg.enabled ? `${supTrace.summary} · ${resilience.action}` : supTrace.summary,
      );

      state.input.executionLog?.info(
        { id: "langgraph_supervisor", name: "LangGraph Supervisor" },
        JSON.stringify({
          approved: nextSupervisorApproved,
          retry: resilienceRoute === "execute_tool" || resilienceRoute === "schedule_tools",
          blockReply: nextBlockReply || !!hitlPendingId,
          resilience: resilience.action,
          checks: supTrace.checks.map((c) => ({ id: c.id, passed: c.passed })),
        }),
      );

      return {
        reply: nextReply,
        supervisorApproved: nextSupervisorApproved,
        supervisorTrace: { ...supTrace, approved: nextSupervisorApproved },
        retryCount: nextRetryCount,
        blockReply: (nextBlockReply || state.blockReply) || !!hitlPendingId,
        hitlPendingId,
        forceMandatoryRecovery,
        resilienceRoute,
        // Fallback seguro: não bloquear por contract gate antigo
        validationBlockSend:
          resilience.action === "apply_fallback" ? false : state.validationBlockSend,
      };
    };

    const humanReview = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("human_review", "Revisão humana (HITL nativo)");
      const decision = interrupt({
        hitlId: state.hitlPendingId,
        replyPreview: state.reply.slice(0, 500),
        supervisorSummary: state.supervisorTrace?.summary ?? "",
      }) as string;
      const approved = decision === "approved";
      state.traceBuilder.emitEvent(
        "hitl",
        approved ? "Aprovado por operador humano" : "Rejeitado por operador humano",
        { metadata: { hitlId: state.hitlPendingId, approved } },
      );
      state.traceBuilder.setNextNode("update_memory");
      state.traceBuilder.endNode(
        "human_review",
        approved ? "ok" : "error",
        approved ? "Resposta aprovada" : "Resposta rejeitada",
      );
      return {
        blockReply: !approved,
        supervisorApproved: approved || state.supervisorApproved,
      };
    };

    const updateMemory = async (state: GraphState): Promise<Partial<GraphState>> => {
      if (state.blockReply) {
        state.traceBuilder.startNode("update_memory", "Atualizar memória");
        state.traceBuilder.endNode("update_memory", "skipped", "Resposta bloqueada pelo supervisor");
        state.traceBuilder.setNextNode("respond");
        return {};
      }

      state.traceBuilder.startNode("update_memory", "Atualizar memória");
      const provider = this.memoryFactory(state.input.engineConfig.memory);
      await provider.saveLegacy(state.input.conversation.id, state.input.organizationId, {
        userMessage: state.input.message.body ?? "",
        assistantMessage: state.reply,
        lastReplyPreview: state.reply.slice(0, 500),
        lastToolOutcomes: state.toolOutcomes.slice(0, 10),
        botId: state.input.bot.id,
        contactId: state.input.contactId ?? null,
      });
      // Espelhar facts EIL + tools OK da sessão em flowSlots (sem sobrescrever __satisfiedToolNames)
      const baseFlowSlots = state.memory?.flowSlots as
        | Record<string, string | number | boolean>
        | undefined;
      const toolOutcomesForSlots = state.toolOutcomes.map((t) => ({
        name: t.name,
        ok: t.ok,
      }));
      const persistedSlots = applyConfirmationPhaseTransitions({
        baseFlowSlots: buildPersistedFlowSlots({
          baseFlowSlots,
          toolOutcomes: toolOutcomesForSlots,
          eilFacts: state.eilSnapshot?.enabled ? state.eilFacts : undefined,
        }),
        toolOutcomes: toolOutcomesForSlots,
        confirmationPrerequisiteTools:
          state.turnContext?.turnPlan.turnPolicy.confirmationPrerequisiteTools ??
          state.engineTurn?.plan.turnPolicy.confirmationPrerequisiteTools,
        completionToolHints:
          state.turnContext?.turnPlan.turnPolicy.completionToolHints ??
          state.engineTurn?.plan.turnPolicy.completionToolHints,
        userMessage: state.input.message.body ?? "",
        lastAssistantPreview: state.reply,
        clearPostCompletionPending: state.engineTurn?.postCompletionFollowUp === true,
      });
      if (state.engineTurn?.workflowRun?.currentStepId) {
        persistedSlots[SESSION_WORKFLOW_PHASE_KEY] = String(
          state.engineTurn.workflowRun.currentStepId,
        );
      }
      if (Object.keys(persistedSlots).length > 0) {
        try {
          await mergeFlowSlotsAutomationContext({
            organizationId: state.input.organizationId,
            conversationId: state.input.conversation.id,
            botId: state.input.bot.id,
            flowSlots: persistedSlots,
          });
        } catch {
          /* best-effort */
        }
      }
      if (state.eilSnapshot) {
        state.traceBuilder.setEilSnapshot(state.eilSnapshot);
      }
      state.traceBuilder.setNextNode("respond");
      state.traceBuilder.endNode("update_memory");
      return {};
    };

    const respond = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("respond", "Responder utilizador");
      const contractBlock = outboundContractGate(state, { canRetry: false });
      if (state.blockReply || contractBlock) {
        const reason = blockReasonFromTurnContract({
          strictMode: state.input.engineConfig.strictMode,
          validationBlockSend: state.validationBlockSend,
          supervisorTrace: state.supervisorTrace,
          retryCount: state.retryCount,
          canRetry: false,
          executionContract: state.turnContext?.executionContract,
          toolOutcomes: state.toolOutcomes,
        });
        if (state.eilSnapshot) {
          state.traceBuilder.setEilSnapshot(state.eilSnapshot);
        }
        state.traceBuilder.endNode("respond", "error", state.hitlPendingId
          ? "Resposta em fila HITL — aguarda aprovação humana"
          : `Resposta bloqueada — ${reason}`);
        state.input.executionLog?.warn(
          { id: "langgraph_supervisor", name: "LangGraph Supervisor" },
          state.hitlPendingId
            ? `Resposta em fila HITL (${state.hitlPendingId})`
            : `Resposta bloqueada: ${reason}`,
        );
        return { reply: "" };
      }

      if (state.eilSnapshot) {
        state.traceBuilder.setEilSnapshot(state.eilSnapshot);
      }

      if (shouldRunWorkflowGate(state.input.engineConfig)) {
        const gate = runWorkflowGate({
          engineConfig: state.input.engineConfig,
          behaviorConfig: state.input.behaviorConfig,
          userMessage: state.input.message.body ?? "",
          replyText: state.reply,
          toolOutcomes: state.toolOutcomes,
          kbMeta: state.kbMeta,
          memorySnapshot: state.memory,
          supervisorTrace: state.supervisorTrace,
          retryCount: state.retryCount,
          previousReply: state.previousReply,
          validationBlockSend: state.validationBlockSend,
          llmSupervisorApproved: state.llmSupervisorApproved,
          llmSupervisorSummary: state.llmSupervisorSummary,
          kbQueryLikely: state.intentHints.kbQueryLikely,
          graphNodeSequence: [
            "classify_intent",
            "load_memory",
            "schedule_tools",
            "execute_tool",
            "validate_result",
            "supervisor",
            "update_memory",
            "respond",
          ],
          eilSnapshot: state.eilSnapshot,
          executionContract: state.turnContext?.executionContract,
          turnPlan: state.turnContext?.turnPlan,
        });
        // WF é diagnóstico: regista findings, NÃO limpa a reply.
        // Bloqueio de outbound cabe só ao Supervisor (state.blockReply acima).
        if (gate.advisoryFailures > 0 || (gate.report && !gate.report.approved)) {
          for (const f of gate.report?.findings.filter((x) => !x.passed) ?? []) {
            state.traceBuilder.addError(`${f.phase}/${f.id}: ${f.description}`);
          }
          state.input.executionLog?.warn(
            { id: "workflow_validator", name: "Workflow Validator" },
            JSON.stringify({
              approved: gate.report?.approved ?? false,
              advisory: true,
              blockReply: false,
              criticalFailures: gate.report?.metrics.criticalFailures,
              requiredToolNames: gate.requiredToolNames,
              advisoryFailures: gate.advisoryFailures,
            }),
          );
        }
      }

      if (state.engineTurn) {
        const finalized = sharedExecutionEngine.finalize(state.engineTurn, "langgraph");
        const snap = sharedExecutionEngine.snapshot(finalized);
        for (const entry of timelineToInspectorEntries(finalized.timeline)) {
          state.input.executionLog?.info(
            { id: entry.id, name: entry.name },
            entry.message,
          );
        }
        state.input.executionLog?.info(
          { id: "execution_engine", name: "Execution Engine" },
          JSON.stringify({
            intent: snap.intentKind,
            required: snap.plan.requiredToolNames,
            pending: snap.contract.pendingToolNames,
            metrics: snap.metrics,
            recoveryCount: snap.recoveryCount,
          }),
        );
      }

      state.traceBuilder.endNode("respond");
      return {};
    };

    const routeAfterSupervisor = (state: GraphState): string => {
      if (state.resilienceRoute === "schedule_tools") return "schedule_tools";
      if (state.resilienceRoute === "execute_tool") return "execute_tool";
      if (state.resilienceRoute === "human_review") return "human_review";
      if (state.resilienceRoute === "update_memory") return "update_memory";

      if (
        state.supervisorTrace &&
        !state.supervisorApproved &&
        shouldRetryAfterSupervisor(
          state.supervisorTrace,
          state.input.engineConfig.strictMode,
          state.retryCount,
        )
      ) {
        return "execute_tool";
      }
      if (
        state.hitlPendingId &&
        state.input.engineConfig.humanInTheLoopNativeEnabled === true
      ) {
        return "human_review";
      }
      return "update_memory";
    };

    return new StateGraph(GraphStateAnnotation)
      .addNode("classify_intent", classifyIntent)
      .addNode("kb_read_node", kbReadNode)
      .addNode("merge_kb_results", mergeKbResults)
      .addNode("load_memory", loadMemory)
      .addNode("schedule_tools", scheduleTools)
      .addNode("execute_tool", executeTool)
      .addNode("validate_result", validateResult)
      .addNode("supervisor", supervisor)
      .addNode("human_review", humanReview)
      .addNode("update_memory", updateMemory)
      .addNode("respond", respond)
      .addEdge(START, "classify_intent")
      .addConditionalEdges("classify_intent", routeAfterClassify, ["load_memory", "kb_read_node"])
      .addEdge("kb_read_node", "merge_kb_results")
      .addEdge("merge_kb_results", "load_memory")
      .addEdge("load_memory", "schedule_tools")
      .addEdge("schedule_tools", "execute_tool")
      .addEdge("execute_tool", "validate_result")
      .addEdge("validate_result", "supervisor")
      .addConditionalEdges("supervisor", routeAfterSupervisor, {
        schedule_tools: "schedule_tools",
        execute_tool: "execute_tool",
        human_review: "human_review",
        update_memory: "update_memory",
      })
      .addEdge("human_review", "update_memory")
      .addEdge("update_memory", "respond")
      .addEdge("respond", END)
      .compile({ checkpointer });
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
