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
import { resolveTurnPolicy, shouldUseReplyOnlyRetry } from "../validators/turnPolicyParser.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { resolveEilTurn } from "../eil/runtimeBridge.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import type { EilSnapshot, FactStore } from "../eil/types.js";

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
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
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
    const replyOnly =
      state.retryCount > 0 &&
      shouldUseReplyOnlyRetry({
        toolOutcomes: state.toolOutcomes,
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
    traceBuilder.endNode("execute_tool", "ok", replyOnly ? "reply-only retry" : undefined);

    traceBuilder.startNode("validate_result", "Validar resultado");
    const userMessage = input.message.body ?? "";
    const requiredToolNames = resolveRequiredToolNamesForValidation(input.behaviorConfig, {
      userMessage,
    });
    const turnPolicy = resolveTurnPolicy(input.behaviorConfig, { userMessage });
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
        }),
      );
      state.supervisorApproved = supTrace.approved;
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
