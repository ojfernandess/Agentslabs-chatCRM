import type {
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeKind,
  AgentRuntimeState,
} from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { resolveRequiredToolNamesForValidation, runWorkflowGate } from "../audit/applyWorkflowGate.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import {
  buildRetryExecutionHints,
  shouldUseReplyOnlyRetryForTurn,
} from "../contract/TurnExecutionContract.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
  shouldBlockReplyAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { resolveEilTurn } from "../eil/runtimeBridge.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import type { EilSnapshot, FactStore } from "../eil/types.js";
import {
  buildExecutionAuditReport,
  checkExecutionConsistency,
  executeRecoveryStrategy,
  extractAvailableToolNamesFromBehavior,
  initializeRuntimeV2,
  mergeRecoveryActions,
  refreshRuntimeV2Orchestrator,
  type RuntimeV2Session,
} from "../v2/index.js";
import { flowSlotsFromMemory } from "../eil/runtimeBridge.js";
import {
  buildCompletionSuccessAck,
  buildPostCheckinDeliveryFallback,
} from "../../agentNativeLlm.js";
import { isContinuationSyntheticMessage } from "../continuation/constants.js";

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
  /** Alertas do último Tool Validator — usados no reply-only retry. */
  lastValidationAlerts?: string[];
  /** Plano de turno calculado uma vez — fonte única de verdade. */
  turnPlan?: import("../planner/ExecutionTurnPlan.js").ExecutionTurnPlan;
  runtimeV2Session?: RuntimeV2Session;
  lastAssistantMessage?: string;
  /** Recovery LLM pendente para próximo retry (provider/model switch). */
  pendingRecovery?: {
    switchProvider: string | null;
    switchModel: string | null;
    recoveryAction?: import("../v2/types.js").ToolRecoveryAction;
  };
};

export type OrchestrationHook = (state: OrchestrationState) => Promise<void>;

export type OrchestrationPlan = {
  graphHistory: string[];
  preMemory?: OrchestrationHook[];
  postExecute?: (state: OrchestrationState) => Promise<"continue" | "retry">;
  postMemory?: OrchestrationHook[];
  maxRetries?: number;
};

/** Planeia recovery (provider/model switch) quando tool obrigatória falhou. */
function planRetryRecovery(state: OrchestrationState): void {
  if (!state.runtimeV2Session) return;
  const consistency = checkExecutionConsistency({
    contract: state.runtimeV2Session.contract,
    toolOutcomes: state.toolOutcomes,
    recoveryAttempt: state.retryCount,
  });
  const action = consistency.recoverySuggested;
  if (!action) return;

  const llm = state.input.llmConfig;
  const currentProvider =
    typeof llm.provider === "string" ? llm.provider : "openai";
  const currentModel = typeof llm.model === "string" ? llm.model : "gpt-4o-mini";
  const exec = executeRecoveryStrategy(action, {
    attempt: state.retryCount,
    toolName: action.toolName,
    currentProvider,
    currentModel,
  });

  state.runtimeV2Session = {
    ...state.runtimeV2Session,
    recoveries: mergeRecoveryActions(state.runtimeV2Session.recoveries, action),
  };

  if (exec.shouldRetry && (exec.switchProvider || exec.switchModel)) {
    state.pendingRecovery = {
      switchProvider: exec.switchProvider,
      switchModel: exec.switchModel,
      recoveryAction: action,
    };
    state.input.executionLog?.info(
      { id: "tool_recovery", name: "Tool Recovery" },
      `${action.kind}: ${action.reason}`,
      {
        output: {
          switchProvider: exec.switchProvider,
          switchModel: exec.switchModel,
          toolName: action.toolName,
        },
      },
    );
  }
}

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
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    retryCount: 0,
    supervisorApproved: true,
    blockReply: false,
  };

  const maxRetries = plan.maxRetries ?? 2;
  const turnPlan =
    input.executionHints?.turnPlan ??
    buildExecutionTurnPlan({
      behaviorConfig: input.behaviorConfig,
      userMessage: input.message.body ?? "",
    });
  state.turnPlan = turnPlan;

  for (const hook of plan.preMemory ?? []) {
    await hook(state);
  }

  traceBuilder.startNode("load_memory", "Carregar memória");
  const provider = createMemoryProvider(input.engineConfig.memory);
  state.memory = await provider.load(input.conversation.id, input.organizationId);
  traceBuilder.setMemorySnapshot(state.memory);
  traceBuilder.endNode("load_memory");

  traceBuilder.startNode("select_tool", "Runtime V2 — contrato + scheduler");
  const availableToolNames = extractAvailableToolNamesFromBehavior(input.behaviorConfig);
  state.runtimeV2Session = initializeRuntimeV2({
    behaviorConfig: input.behaviorConfig,
    userMessage: input.message.body ?? "",
    availableToolNames,
    lastAssistantMessage: state.lastAssistantMessage,
    flowSlots: flowSlotsFromMemory(state.memory),
    existingTurnPlan: turnPlan,
  });
  traceBuilder.endNode("select_tool", "ok", state.runtimeV2Session.orchestrator.reason);

  for (;;) {
    const replyOnly =
      state.retryCount > 0 &&
      shouldUseReplyOnlyRetryForTurn({
        turnPlan,
        toolOutcomes: state.toolOutcomes,
        supervisorChecks: state.lastSupervisorChecks,
        validationAlerts: state.lastValidationAlerts,
      });
    const priorOk = state.toolOutcomes.filter((t) => t.ok);
    traceBuilder.startNode("execute_tool", "Executar agente + ferramentas");
    const { reply, toolOutcomes = [], kbMeta } = await executor({
      ...input,
      executionHints: {
        ...buildRetryExecutionHints({
          turnPlan,
          replyOnly,
          priorSuccessfulToolOutcomes: priorOk,
        }),
        runtimeV2: state.runtimeV2Session
          ? {
              contractId: state.runtimeV2Session.contract.contractId,
              orchestratorPromptBlock: state.runtimeV2Session.orchestratorPromptBlock,
              orchestrator: state.runtimeV2Session.orchestrator,
            }
          : undefined,
        recovery: state.pendingRecovery,
      },
    });
    state.pendingRecovery = undefined;
    state.reply = reply;
    state.toolOutcomes =
      replyOnly && priorOk.length > 0
        ? [
            ...priorOk,
            ...toolOutcomes.filter((t) => !priorOk.some((p) => p.name === t.name && p.ok)),
          ]
        : toolOutcomes;
    state.kbMeta = kbMeta ?? { hasUsefulExcerpts: false, coversQuery: false };
    const eil = resolveEilTurn({
      behaviorConfig: input.behaviorConfig,
      userMessage: input.message.body ?? "",
      memory: state.memory,
      toolOutcomes: state.toolOutcomes,
      replyText: state.reply,
      priorFacts: state.eilFacts,
    });
    state.eilFacts = eil.facts;
    state.eilSnapshot = eil.snapshot;
    if (state.runtimeV2Session) {
      state.runtimeV2Session = refreshRuntimeV2Orchestrator(
        state.runtimeV2Session,
        availableToolNames,
        state.toolOutcomes,
      );
    }
    traceBuilder.endNode("execute_tool", "ok", replyOnly ? "reply-only retry" : undefined);

    traceBuilder.startNode("validate_result", "Validar resultado");
    const userMessage = input.message.body ?? "";
    const requiredToolNames = turnPlan.requiredToolNames.length
      ? turnPlan.requiredToolNames
      : resolveRequiredToolNamesForValidation(input.behaviorConfig, { userMessage });
    const turnPolicy = turnPlan.turnPolicy;
    const validation = validateToolExecution({
      toolOutcomes: state.toolOutcomes,
      replyText: state.reply,
      strictMode: input.engineConfig.strictMode,
      requiredToolNames,
      turnPolicy,
      behaviorConfig: input.behaviorConfig,
      userMessage,
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
      const eilRefresh = resolveEilTurn({
        behaviorConfig: input.behaviorConfig,
        userMessage,
        memory: state.memory,
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        priorFacts: state.eilFacts,
      });
      state.eilSnapshot = eilRefresh.snapshot;
      state.eilFacts = eilRefresh.facts;
      const consistency = state.runtimeV2Session
        ? checkExecutionConsistency({
            contract: state.runtimeV2Session.contract,
            toolOutcomes: state.toolOutcomes,
          })
        : null;
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
          eilEnabled: eilRefresh.enabled,
          eilPlan: eilRefresh.plan,
          eilViolations: eilRefresh.snapshot.violations,
          eilRequiredFactsMissing: eilRefresh.plan.pendingFacts,
          turnPolicy,
          executionContract: state.runtimeV2Session?.contract ?? null,
          consistencyDivergences: consistency?.divergences,
        }),
      );
      state.supervisorApproved = supTrace.approved;
      state.lastSupervisorChecks = supTrace.checks.map((c) => ({ id: c.id, passed: c.passed }));
      state.blockReply = shouldBlockReplyAfterSupervisor(
        supTrace,
        input.engineConfig.strictMode,
        state.retryCount,
      );
      traceBuilder.endNode("supervisor", supTrace.approved ? "ok" : "warn", supTrace.summary);
    } else {
      // Sem Supervisor: respeitar Tool Validator no modo estrito
      const block =
        input.engineConfig.strictMode && validation.blockSend === true;
      state.supervisorApproved = !block;
      if (block) state.blockReply = true;
    }
    state.lastValidationAlerts = validation.alerts;

    if (plan.postExecute) {
      const decision = await plan.postExecute(state);
      if (decision === "retry" && state.retryCount < maxRetries) {
        planRetryRecovery(state);
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
      planRetryRecovery(state);
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
    const slots: Record<string, string | number | boolean> = {};
    for (const [k, f] of Object.entries(state.eilFacts)) {
      if (f.value !== null && f.value !== undefined) slots[k] = f.value as string | number | boolean;
    }
    if (Object.keys(slots).length > 0) {
      try {
        await mergeFlowSlotsAutomationContext({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          botId: input.bot.id,
          flowSlots: slots,
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
    executionContract: state.runtimeV2Session?.contract ?? null,
  });
  // WF diagnóstico: não limpa reply. Bloqueio só via Supervisor / Tool Validator.
  if (state.blockReply) {
    const completionAck = buildCompletionSuccessAck(state.toolOutcomes);
    const isCont = isContinuationSyntheticMessage(state.input.message.body ?? "");
    const fallback =
      completionAck ??
      (isCont
        ? buildPostCheckinDeliveryFallback(flowSlotsFromMemory(state.memory))
        : null);
    if (fallback) {
      state.reply = fallback;
      traceBuilder.endNode("respond", "warn", "blockReply contornado — fallback Runtime V2");
    } else {
      traceBuilder.endNode("respond", "error", "Tool Validator / Supervisor bloqueou envio (modo estrito)");
      state.reply = "";
    }
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

  const trace = traceBuilder.build();
  if (state.runtimeV2Session) {
    const consistency = checkExecutionConsistency({
      contract: state.runtimeV2Session.contract,
      toolOutcomes: state.toolOutcomes,
    });
    const audit = buildExecutionAuditReport({
      contract: state.runtimeV2Session.contract,
      startedAt: state.runtimeV2Session.startedAt,
      finishedAt: new Date().toISOString(),
      executedTools: state.toolOutcomes.filter((t) => t.ok).map((t) => t.name),
      toolOutcomes: state.toolOutcomes,
      factsProduced: Object.keys(state.eilFacts ?? {}),
      divergences: consistency.divergences,
      recoveries: state.runtimeV2Session.recoveries,
      blocks: state.runtimeV2Session.blocks,
      decisions: {
        orchestrator: state.runtimeV2Session.orchestrator,
        preExecution: state.runtimeV2Session.preValidation,
        consistency,
      },
      supervisorRetries: state.retryCount,
    });
    trace.runtimeV2 = {
      contractId: state.runtimeV2Session.contract.contractId,
      intent: state.runtimeV2Session.contract.intent.label,
      phase: state.runtimeV2Session.contract.plan.phase,
      mandatoryNextTool: state.runtimeV2Session.orchestrator.mandatoryNextTool,
      pendingRequired: state.runtimeV2Session.orchestrator.pendingRequired,
      orchestratorReason: state.runtimeV2Session.orchestrator.reason,
      auditRootCause: audit.rootCause,
    };
  }
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
