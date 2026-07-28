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
  resolveRequiredToolNamesForValidation,
  runWorkflowGate,
  shouldRunWorkflowGate,
} from "../audit/applyWorkflowGate.js";
import { resolveTurnPolicy } from "../validators/turnPolicyParser.js";
import { buildExecutionTurnPlan, type ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import {
  buildRetryExecutionHints,
  shouldUseReplyOnlyRetryForTurn,
} from "../contract/TurnExecutionContract.js";
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
import { publishGraphEvent } from "../observability/AgentGraphEventBus.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import type { AgentCheckpointStoreKind } from "../types.js";
import { resolveEilTurn } from "../eil/runtimeBridge.js";
import type { EilSnapshot, ExecutionIntelligencePlan, FactStore } from "../eil/types.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";

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
  /** Alertas do último Tool Validator — reply-only retry. */
  lastValidationAlerts: string[];
  turnPlan: ExecutionTurnPlan;
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
  lastValidationAlerts: Annotation<string[]>,
  turnPlan: Annotation<ExecutionTurnPlan>,
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

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
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
    const turnPlan =
      input.executionHints?.turnPlan ??
      buildExecutionTurnPlan({
        behaviorConfig: input.behaviorConfig,
        userMessage: input.message.body ?? "",
      });
    const inputWithTurnPlan: AgentRuntimeExecuteInput = {
      ...input,
      executionHints: { ...input.executionHints, turnPlan },
    };
    const initialState: GraphState = {
      input: inputWithTurnPlan,
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
      lastValidationAlerts: [],
      turnPlan,
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
            "select_tool",
            "execute_tool",
            "validate_result",
            "supervisor",
            "human_review",
          ]
        : [
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
      }),
    );

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

    return { reply: result.blockReply ? "" : result.reply, trace };
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
      const eilBoot = resolveEilTurn({
        behaviorConfig: state.input.behaviorConfig,
        userMessage: state.input.message.body ?? "",
        memory,
      });
      state.traceBuilder.setNextNode("select_tool");
      state.traceBuilder.endNode("load_memory");
      return {
        memory,
        eilFacts: eilBoot.facts,
        eilPlan: eilBoot.plan,
        eilSnapshot: eilBoot.snapshot,
      };
    };

    const selectTool = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("select_tool", "Selecionar ferramenta");
      const behavior = state.input.behaviorConfig ?? {};
      const nativeTools =
        behavior && typeof behavior === "object"
          ? ((behavior as Record<string, unknown>).nativeTools as Record<string, unknown> | undefined)
          : undefined;
      const toolCount = nativeTools ? Object.values(nativeTools).filter(Boolean).length : 0;
      const eil = resolveEilTurn({
        behaviorConfig: state.input.behaviorConfig,
        userMessage: state.input.message.body ?? "",
        memory: state.memory,
        priorFacts: state.eilFacts,
      });
      state.traceBuilder.setNextNode("execute_tool");
      state.traceBuilder.endNode(
        "select_tool",
        "ok",
        toolCount > 0
          ? `${toolCount} ferramenta(s) disponível(eis)${eil.enabled ? " · EIL" : ""}`
          : "delegar ao executor nativo",
      );
      return {
        eilPlan: eil.plan,
        eilFacts: eil.facts,
        eilSnapshot: eil.snapshot,
      };
    };

    const executeTool = async (state: GraphState): Promise<Partial<GraphState>> => {
      state.traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
      const replyOnly =
        state.retryCount > 0 &&
        shouldUseReplyOnlyRetryForTurn({
          turnPlan: state.turnPlan,
          toolOutcomes: state.toolOutcomes,
          supervisorChecks: state.supervisorTrace?.checks,
          validationAlerts: state.lastValidationAlerts,
        });
      const priorOk = state.toolOutcomes.filter((t) => t.ok);
      const execResult = await executor({
        ...state.input,
        kbPrefetchAppendix: state.kbPrefetchAppendix,
        executionHints: buildRetryExecutionHints({
          turnPlan: state.turnPlan,
          replyOnly,
          priorSuccessfulToolOutcomes: priorOk,
        }),
      });
      state.traceBuilder.setNextNode("validate_result");
      state.traceBuilder.endNode(
        "execute_tool",
        "ok",
        replyOnly ? "reply-only retry (sem reexecutar tools mutáveis)" : undefined,
      );
      const nextOutcomes =
        replyOnly && priorOk.length > 0
          ? [
              ...priorOk,
              ...(execResult.toolOutcomes ?? []).filter(
                (t) => !priorOk.some((p) => p.name === t.name && p.ok),
              ),
            ]
          : (execResult.toolOutcomes ?? []);
      const eil = resolveEilTurn({
        behaviorConfig: state.input.behaviorConfig,
        userMessage: state.input.message.body ?? "",
        memory: state.memory,
        toolOutcomes: nextOutcomes,
        replyText: execResult.reply,
        priorFacts: state.eilFacts,
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
      const requiredToolNames = state.turnPlan.requiredToolNames.length
        ? state.turnPlan.requiredToolNames
        : resolveRequiredToolNamesForValidation(state.input.behaviorConfig, {
            userMessage,
          });
      const turnPolicy = state.turnPlan.turnPolicy;
      const validation = validateToolExecution({
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        strictMode: state.input.engineConfig.strictMode,
        requiredToolNames,
        turnPolicy,
        behaviorConfig: state.input.behaviorConfig,
        userMessage,
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
      const eil = resolveEilTurn({
        behaviorConfig: state.input.behaviorConfig,
        userMessage,
        memory: state.memory,
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        priorFacts: state.eilFacts,
      });
      state.traceBuilder.setNextNode("supervisor");
      state.traceBuilder.endNode(
        "validate_result",
        validation.blockSend && state.input.engineConfig.strictMode ? "error" : "ok",
      );
      return {
        validationBlockSend: validation.blockSend,
        lastValidationAlerts: validation.alerts,
        eilPlan: eil.plan,
        eilFacts: eil.facts,
        eilSnapshot: eil.snapshot,
      };
    };

    const supervisor = async (state: GraphState): Promise<Partial<GraphState>> => {
      if (!state.input.engineConfig.supervisorEnabled) {
        // Sem Supervisor: ainda assim respeitar Tool Validator no modo estrito
        // (ex.: CPF sem audaar_consultar_main_guest → não enviar reply inventada).
        const blockReply =
          state.input.engineConfig.strictMode && state.validationBlockSend === true;
        return {
          supervisorApproved: !blockReply,
          blockReply: blockReply || state.blockReply,
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
        state.traceBuilder.emitEvent("supervisor", summary, { metadata: { mode: "llm", approved } });
        state.traceBuilder.setNextNode("update_memory");
        state.traceBuilder.endNode("supervisor", approved ? "ok" : "warn", summary);
        return { supervisorApproved: approved, supervisorTrace: supTrace };
      }

      const turnPolicy = resolveTurnPolicy(state.input.behaviorConfig, {
        userMessage: state.input.message.body ?? "",
      });
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
      });
      const supTrace = buildSupervisorTrace(supInput);

      const retry = shouldRetryAfterSupervisor(
        supTrace,
        state.input.engineConfig.strictMode,
        state.retryCount,
      );
      const blockReply = shouldBlockReplyAfterSupervisor(
        supTrace,
        state.input.engineConfig.strictMode,
        state.retryCount,
      );

      let hitlPendingId = state.hitlPendingId;
      const hitlEnabled = state.input.engineConfig.humanInTheLoopEnabled === true;
      const hitlNative = state.input.engineConfig.humanInTheLoopNativeEnabled === true;
      const checkpointStore = state.input.engineConfig.checkpointStore ?? "memory";
      const threadId = `${state.input.conversation.id}:${state.input.message.id}`;
      if (
        hitlEnabled &&
        !supTrace.approved &&
        !retry &&
        state.reply.trim() &&
        (blockReply || state.input.engineConfig.strictMode)
      ) {
        const pending = registerHitlPending({
          organizationId: state.input.organizationId,
          conversationId: state.input.conversation.id,
          messageId: state.input.message.id,
          botId: state.input.bot.id,
          replyPreview: state.reply,
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

      if (retry) {
        state.traceBuilder.emitEvent("retry", "Supervisor solicitou nova execução", {
          nodeId: "execute_tool",
          metadata: { retryCount: state.retryCount + 1 },
        });
      }
      state.traceBuilder.emitEvent("supervisor", supTrace.summary, {
        metadata: { approved: supTrace.approved, checks: supTrace.checks.length },
      });

      state.traceBuilder.setNextNode(retry ? "execute_tool" : "update_memory");
      state.traceBuilder.endNode("supervisor", supTrace.approved ? "ok" : "warn", supTrace.summary);

      state.input.executionLog?.info(
        { id: "langgraph_supervisor", name: "LangGraph Supervisor" },
        JSON.stringify({
          approved: supTrace.approved,
          retry,
          blockReply,
          checks: supTrace.checks.map((c) => ({ id: c.id, passed: c.passed })),
        }),
      );

      return {
        supervisorApproved: supTrace.approved,
        supervisorTrace: supTrace,
        retryCount: retry ? state.retryCount + 1 : state.retryCount,
        blockReply: (blockReply || state.blockReply) || !!hitlPendingId,
        hitlPendingId,
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
      // Espelhar facts EIL em flowSlots (session facts)
      if (state.eilSnapshot?.enabled && Object.keys(state.eilFacts).length > 0) {
        const slots: Record<string, string | number | boolean> = {};
        for (const [k, f] of Object.entries(state.eilFacts)) {
          if (f.value !== null && f.value !== undefined) slots[k] = f.value as string | number | boolean;
        }
        if (Object.keys(slots).length > 0) {
          try {
            await mergeFlowSlotsAutomationContext({
              organizationId: state.input.organizationId,
              conversationId: state.input.conversation.id,
              botId: state.input.bot.id,
              flowSlots: slots,
            });
          } catch {
            /* best-effort */
          }
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
      if (state.blockReply) {
        if (state.eilSnapshot) {
          state.traceBuilder.setEilSnapshot(state.eilSnapshot);
        }
        state.traceBuilder.endNode("respond", "error", state.hitlPendingId
          ? "Resposta em fila HITL — aguarda aprovação humana"
          : "Resposta bloqueada — supervisor reprovou após retries");
        state.input.executionLog?.warn(
          { id: "langgraph_supervisor", name: "LangGraph Supervisor" },
          state.hitlPendingId
            ? `Resposta em fila HITL (${state.hitlPendingId})`
            : "Resposta bloqueada após esgotar retries do supervisor",
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
            "select_tool",
            "execute_tool",
            "validate_result",
            "supervisor",
            "update_memory",
            "respond",
          ],
          eilSnapshot: state.eilSnapshot,
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

      state.traceBuilder.endNode("respond");
      return {};
    };

    const routeAfterSupervisor = (state: GraphState): string => {
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
      .addNode("select_tool", selectTool)
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
      .addEdge("load_memory", "select_tool")
      .addEdge("select_tool", "execute_tool")
      .addEdge("execute_tool", "validate_result")
      .addEdge("validate_result", "supervisor")
      .addConditionalEdges("supervisor", routeAfterSupervisor, {
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
