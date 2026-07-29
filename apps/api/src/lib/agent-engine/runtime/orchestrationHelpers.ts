import type {
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeKind,
  AgentRuntimeState,
} from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider as defaultCreateMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { runWorkflowGate } from "../audit/applyWorkflowGate.js";
import { shouldUseReplyOnlyRetry } from "../validators/turnPolicyParser.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import { buildPersistedFlowSlots } from "../core/sessionToolOutcomes.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import type { EilSnapshot, FactStore } from "../eil/types.js";
import {
  sharedExecutionEngine,
  timelineToInspectorEntries,
  type EngineTurnState,
} from "../engine/index.js";

export type OrchestrationState = {
  input: AgentRuntimeExecuteInput;
  executor: NativeAgentExecutor;
  traceBuilder: ExecutionTraceBuilder;
  memory: Record<string, unknown>;
  reply: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  kbMeta: { hasUsefulExcerpts: boolean; coversQuery: boolean };
  retryCount: number;
  supervisorApproved: boolean;
  blockReply?: boolean;
  eilFacts?: FactStore;
  eilSnapshot?: EilSnapshot;
  /** Checks do último Supervisor — usados no reply-only retry. */
  lastSupervisorChecks?: Array<{ id: string; passed: boolean }>;
  engineTurn?: EngineTurnState;
};

export type OrchestrationHook = (state: OrchestrationState) => Promise<void>;

export type OrchestrationPlan = {
  graphHistory: string[];
  preMemory?: OrchestrationHook[];
  postExecute?: (state: OrchestrationState) => Promise<"continue" | "retry">;
  postMemory?: OrchestrationHook[];
  maxRetries?: number;
};

export type OrchestrationDeps = {
  createMemoryProvider?: typeof defaultCreateMemoryProvider;
};

export async function runOrchestratedRuntime(
  kind: AgentRuntimeKind,
  input: AgentRuntimeExecuteInput,
  executor: NativeAgentExecutor,
  plan: OrchestrationPlan,
  deps: OrchestrationDeps = {},
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
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    retryCount: 0,
    supervisorApproved: true,
  };

  const maxRetries = plan.maxRetries ?? 2;

  for (const hook of plan.preMemory ?? []) {
    await hook(state);
  }

  traceBuilder.startNode("load_memory", "Carregar memória");
  const createMemory = deps.createMemoryProvider ?? defaultCreateMemoryProvider;
  const provider = createMemory(input.engineConfig.memory);
  state.memory = await provider.load(input.conversation.id, input.organizationId);
  traceBuilder.setMemorySnapshot(state.memory);
  state.engineTurn = sharedExecutionEngine.beginTurn({
    input,
    memory: state.memory,
  });
  state.eilFacts = state.engineTurn.turnContext.facts;
  state.eilSnapshot = state.engineTurn.turnContext.eilSnapshot;
  traceBuilder.emitEvent("turn_context", "ExecutionEngine beginTurn", {
    metadata: {
      intent: state.engineTurn.turnContext.intent.kind,
      requiredTools: state.engineTurn.contract.requiredToolNames,
      promptHash: state.engineTurn.turnContext.promptContract.promptHash,
    },
  });
  traceBuilder.endNode("load_memory");

  for (;;) {
    const replyOnly =
      state.retryCount > 0 &&
      shouldUseReplyOnlyRetry({
        toolOutcomes: state.toolOutcomes,
        supervisorChecks: state.lastSupervisorChecks,
      });
    const priorOk = state.toolOutcomes.filter((t) => t.ok);
    traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
    const { reply, toolOutcomes = [], kbMeta } = await executor({
      ...input,
      executionHints: replyOnly
        ? { replyOnlyRetry: true, priorSuccessfulToolOutcomes: priorOk }
        : input.executionHints,
    });
    state.reply = reply;
    state.toolOutcomes =
      replyOnly && priorOk.length > 0
        ? [
            ...priorOk,
            ...toolOutcomes.filter((t) => !priorOk.some((p) => p.name === t.name && p.ok)),
          ]
        : toolOutcomes;
    state.kbMeta = kbMeta ?? { hasUsefulExcerpts: false, coversQuery: false };
    if (state.engineTurn) {
      state.engineTurn = sharedExecutionEngine.refreshTurnWithBehavior(
        state.engineTurn,
        input.behaviorConfig,
        {
          toolOutcomes: state.toolOutcomes,
          memory: state.memory,
          priorFacts: state.eilFacts,
          phase: "validate",
        },
      );
      state.eilFacts = state.engineTurn.turnContext.facts;
      state.eilSnapshot = state.engineTurn.turnContext.eilSnapshot;
    }
    traceBuilder.endNode("execute_tool", "ok", replyOnly ? "reply-only retry" : undefined);

    traceBuilder.startNode("validate_result", "Validar resultado");
    const userMessage = input.message.body ?? "";
    const requiredToolNames = state.engineTurn?.plan.requiredToolNames ?? [];
    const turnPolicy = state.engineTurn?.plan.turnPolicy ?? {
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
      strictMode: input.engineConfig.strictMode,
      requiredToolNames,
      turnPolicy,
      behaviorConfig: state.engineTurn ? undefined : input.behaviorConfig,
      userMessage,
      capabilityGraph: state.engineTurn?.turnContext.capabilityGraph,
      factsBeforeTurn: state.eilFacts ?? state.engineTurn?.turnContext.facts,
    });
    if (!validation.ok) {
      for (const alert of validation.alerts) traceBuilder.addError(alert);
      input.executionLog?.warn(
        { id: "tool_validator", name: "Tool Validator" },
        validation.alerts.join("; "),
      );
      try {
        const reverted = await maybeRevertIllegalHandoffAfterValidation({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          toolOutcomes: state.toolOutcomes,
          validationAlerts: validation.alerts,
          turnPolicy,
        });
        if (reverted) {
          input.executionLog?.info(
            { id: "handoff_revert", name: "Handoff revert" },
            "Handoff ilegal revertido após validação de turno",
          );
        }
      } catch {
        /* best-effort — não bloquear turno */
      }
    }
    traceBuilder.endNode(
      "validate_result",
      validation.blockSend && input.engineConfig.strictMode ? "error" : "ok",
    );

    if (input.engineConfig.supervisorEnabled) {
      traceBuilder.startNode("supervisor", "Supervisor IA");
      const eng = state.engineTurn;
      const supTrace = buildSupervisorTrace(
        buildSupervisorValidationInput({
          userMessage: input.message.body ?? "",
          replyText: state.reply,
          toolOutcomes: state.toolOutcomes,
          kbMeta: state.kbMeta,
          strictMode: input.engineConfig.strictMode,
          memorySnapshot: state.memory,
          retryCount: state.retryCount,
          validationBlockSend: validation.blockSend,
          eilEnabled: eng?.turnContext.eilEnabled === true,
          eilPlan: eng?.turnContext.eilPlan,
          eilViolations: eng?.turnContext.eilSnapshot?.violations,
          eilRequiredFactsMissing: eng?.turnContext.eilPlan?.pendingFacts,
          turnPolicy,
          executionContract: eng?.contract ?? null,
        }),
      );
      state.supervisorApproved = supTrace.approved;
      state.lastSupervisorChecks = supTrace.checks.map((c) => ({ id: c.id, passed: c.passed }));
      traceBuilder.endNode("supervisor", supTrace.approved ? "ok" : "warn", supTrace.summary);
    } else {
      // Sem Supervisor: respeitar Tool Validator no modo estrito
      const block =
        input.engineConfig.strictMode && validation.blockSend === true;
      state.supervisorApproved = !block;
      if (block) state.blockReply = true;
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
        buildSupervisorTrace(
          buildSupervisorValidationInput({
            userMessage: input.message.body ?? "",
            replyText: state.reply,
            toolOutcomes: state.toolOutcomes,
            kbMeta: state.kbMeta,
            strictMode: input.engineConfig.strictMode,
            memorySnapshot: state.memory,
            retryCount: state.retryCount,
            validationBlockSend: validation.blockSend,
            turnPolicy,
          }),
        ),
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
  if (state.eilSnapshot?.enabled && state.eilFacts && Object.keys(state.eilFacts).length > 0) {
    const baseFlowSlots = state.memory?.flowSlots as
      | Record<string, string | number | boolean>
      | undefined;
    const persistedSlots = buildPersistedFlowSlots({
      baseFlowSlots,
      toolOutcomes: state.toolOutcomes.map((t) => ({ name: t.name, ok: t.ok })),
      eilFacts: state.eilFacts,
    });
    if (Object.keys(persistedSlots).length > 0) {
      try {
        await mergeFlowSlotsAutomationContext({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          botId: input.bot.id,
          flowSlots: persistedSlots,
        });
      } catch {
        /* best-effort */
      }
    }
  } else if (state.toolOutcomes.some((t) => t.ok)) {
    const baseFlowSlots = state.memory?.flowSlots as
      | Record<string, string | number | boolean>
      | undefined;
    const persistedSlots = buildPersistedFlowSlots({
      baseFlowSlots,
      toolOutcomes: state.toolOutcomes.map((t) => ({ name: t.name, ok: t.ok })),
    });
    if (Object.keys(persistedSlots).length > 0) {
      try {
        await mergeFlowSlotsAutomationContext({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          botId: input.bot.id,
          flowSlots: persistedSlots,
        });
      } catch {
        /* best-effort */
      }
    }
  }
  if (state.eilSnapshot) {
    traceBuilder.setEilSnapshot(state.eilSnapshot);
  }
  traceBuilder.endNode("update_memory");

  traceBuilder.startNode("respond", "Responder utilizador");

  const gate = runWorkflowGate({
    engineConfig: input.engineConfig,
    behaviorConfig: input.behaviorConfig,
    userMessage: input.message.body ?? "",
    replyText: state.reply,
    toolOutcomes: state.toolOutcomes,
    kbMeta: state.kbMeta,
    memorySnapshot: state.memory,
    retryCount: state.retryCount,
    graphNodeSequence: plan.graphHistory,
    eilSnapshot: state.eilSnapshot,
    turnPlan: state.engineTurn?.turnContext.turnPlan,
    executionContract: state.engineTurn?.contract,
  });
  // WF diagnóstico: não limpa reply. Bloqueio só via Supervisor / Tool Validator.
  if (state.blockReply) {
    traceBuilder.endNode("respond", "error", "Tool Validator / Supervisor bloqueou envio (modo estrito)");
    state.reply = "";
  } else if (gate.advisoryFailures > 0 || (gate.report && !gate.report.approved)) {
    input.executionLog?.warn(
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
    for (const f of gate.report?.findings.filter((x) => !x.passed) ?? []) {
      traceBuilder.addError(`${f.phase}/${f.id}: ${f.description}`);
    }
    traceBuilder.endNode("respond");
  } else {
    traceBuilder.endNode("respond");
  }

  if (state.engineTurn) {
    state.engineTurn = sharedExecutionEngine.finalize(state.engineTurn, kind);
    for (const entry of timelineToInspectorEntries(state.engineTurn.timeline)) {
      input.executionLog?.info({ id: entry.id, name: entry.name }, entry.message);
    }
  }

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
    protected readonly deps: OrchestrationDeps = {},
  ) {}

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    this.state = { status: "running", graphHistory: [], currentNode: "load_memory" };
    const { result, runtimeState } = await runOrchestratedRuntime(
      this.kind,
      input,
      this.executor,
      this.plan,
      this.deps,
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
