import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import { runWorkflowGate } from "../audit/applyWorkflowGate.js";
import { flowSlotsFromMemory } from "../eil/runtimeBridge.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import {
  applyConfirmationPhaseTransitions,
  buildPersistedFlowSlots,
} from "../core/sessionToolOutcomes.js";
import {
  blockReasonFromTurnContract,
  shouldBlockOutboundFromTurnContract,
} from "../core/executionContractGate.js";
import {
  sharedExecutionEngine,
  timelineToInspectorEntries,
  type EngineTurnState,
} from "../engine/index.js";
import {
  planScheduledToolInvocations,
  shouldRunToolScheduler,
  formatScheduledToolsSystemAppendix,
} from "../scheduler/TurnToolScheduler.js";
import { invokeScheduledTools } from "../scheduler/invokeScheduledTools.js";
import { runContinuationIfEnabled } from "../continuation/runContinuation.js";
import { executeRuntimeStream, type StreamRuntimeEvent } from "./StreamingRuntime.js";
import { ingestAgentTraceToOtel } from "../observability/OtelBridge.js";

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
 * Runtime padrão — orquestra via ExecutionEngine + pipeline nativo.
 * Persiste tools OK em flowSlots para confirmações multi-turno.
 */
export class OpenNexoRuntime implements AgentRuntime {
  readonly kind = "openconduit" as const;

  constructor(private readonly executor: NativeAgentExecutor) {}

  executeStream(input: AgentRuntimeExecuteInput): AsyncGenerator<StreamRuntimeEvent> {
    return executeRuntimeStream(this, input);
  }

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    const engine = sharedExecutionEngine;
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

    let engineState: EngineTurnState = engine.beginTurn({
      input,
      memory: memSnap as Record<string, unknown>,
    });
    traceBuilder.emitEvent("turn_context", "ExecutionEngine beginTurn", {
      metadata: {
        intent: engineState.turnContext.intent.kind,
        requiredTools: engineState.contract.requiredToolNames,
        contractValid: engineState.contract.valid,
        promptHash: engineState.turnContext.promptContract.promptHash,
      },
    });

    const tWf = Date.now();
    const continuation = await runContinuationIfEnabled({
      engineConfig: input.engineConfig,
      behaviorConfig: input.behaviorConfig as Record<string, unknown>,
      organizationId: input.organizationId,
      conversationId: input.conversation.id,
      userMessage: input.message.body ?? "",
      vars: {
        facts: engineState.turnContext.facts,
        flowSlots: flowSlotsFromMemory(memSnap as Record<string, unknown>),
      },
    });
    if (continuation.enabled && continuation.state) {
      engineState = engine.attachWorkflow(engineState, continuation.state);
      engineState = engine.recordPhase(
        engineState,
        "workflow",
        `${continuation.state.status}:${continuation.state.currentStepId ?? "done"}`,
        {
          resumed: continuation.resumed,
          workflowId: continuation.state.workflowId,
          plannedTools: continuation.state.plannedToolNames,
          suspendReason: continuation.state.suspendReason,
        },
        Date.now() - tWf,
      );
      input.executionLog?.info(
        { id: "workflow_engine", name: "Workflow Step Engine" },
        JSON.stringify({
          resumed: continuation.resumed,
          status: continuation.state.status,
          currentStepId: continuation.state.currentStepId,
          plannedToolNames: continuation.state.plannedToolNames,
          suspendReason: continuation.state.suspendReason,
        }),
      );
      traceBuilder.emitEvent("workflow_engine", "Continuation advance", {
        metadata: {
          status: continuation.state.status,
          resumed: continuation.resumed,
          plannedTools: continuation.state.plannedToolNames,
        },
      });
    }

    let toolOutcomes: Array<{
      name: string;
      ok: boolean;
      preview: string;
      structuredPayload?: unknown;
    }> = [];
    let scheduledAppendix = "";

    const canSchedule = shouldRunToolScheduler(input.engineConfig, input.executionHints);
    if (canSchedule) {
      const t0 = Date.now();
      traceBuilder.startNode("schedule_tools", "Tool Scheduler");
      const plan = planScheduledToolInvocations(engineState.turnContext, toolOutcomes);
      if (plan.length > 0) {
        const scheduled = await invokeScheduledTools({
          organizationId: input.organizationId,
          bot: input.bot,
          conversation: input.conversation,
          message: input.message,
          log: input.log,
          behaviorConfig: input.behaviorConfig,
          turnContext: engineState.turnContext,
          existingOutcomes: toolOutcomes,
          userMessage: input.message.body ?? "",
        });
        toolOutcomes = scheduled.outcomes.map(({ name, ok, preview, structuredPayload }) => ({
          name,
          ok,
          preview,
          structuredPayload,
        }));
        scheduledAppendix = formatScheduledToolsSystemAppendix(
          toolOutcomes.map((o) => ({
            name: o.name,
            ok: o.ok,
            preview: o.preview,
            structuredPayload: o.structuredPayload,
          })),
        );
        engineState = engine.refreshTurnWithBehavior(engineState, input.behaviorConfig, {
          toolOutcomes,
          memory: memSnap as Record<string, unknown>,
          phase: "schedule",
        });
        input.executionLog?.info(
          { id: "tool_scheduler", name: "Tool Scheduler" },
          JSON.stringify({
            planned: plan.map((p) => p.toolName),
            executed: toolOutcomes.map((o) => o.name),
          }),
        );
      }
      engineState = engine.recordPhase(
        engineState,
        "schedule",
        `${toolOutcomes.length} scheduled`,
        undefined,
        Date.now() - t0,
      );
      traceBuilder.endNode(
        "schedule_tools",
        "ok",
        toolOutcomes.length > 0
          ? `${toolOutcomes.length} tool(s) pré-executada(s)`
          : "nenhuma tool obrigatória pendente",
      );
    }

    const tExec = Date.now();
    traceBuilder.startNode("respond", "OpenNexo Runtime");
    const execResult = await this.executor({
      ...input,
      executionHints: {
        ...input.executionHints,
        preScheduledToolOutcomes:
          toolOutcomes.length > 0
            ? toolOutcomes
            : input.executionHints?.preScheduledToolOutcomes,
      },
    });
    const reply = execResult.reply;
    const llmOutcomes = execResult.toolOutcomes ?? [];
    // Preferir sucesso do LLM quando o Scheduler falhou (ex.: schema fill depois corrigido).
    const merged: typeof toolOutcomes = [];
    for (const o of [...llmOutcomes, ...toolOutcomes]) {
      const key = o.name.trim().toLowerCase();
      const existing = merged.find((m) => m.name.trim().toLowerCase() === key);
      if (!existing) {
        merged.push(o);
        continue;
      }
      if (!existing.ok && o.ok) {
        const idx = merged.indexOf(existing);
        merged[idx] = o;
      }
    }
    toolOutcomes = merged;
    engineState = engine.recordPhase(
      engineState,
      "execute_llm",
      scheduledAppendix ? "with_scheduler" : undefined,
      undefined,
      Date.now() - tExec,
    );
    traceBuilder.endNode("respond");

    const baseSlots = flowSlotsFromMemory(memSnap as Record<string, unknown>);
    let persistedSlots = buildPersistedFlowSlots({
      baseFlowSlots: baseSlots,
      toolOutcomes,
    });
    persistedSlots = applyConfirmationPhaseTransitions({
      baseFlowSlots: persistedSlots,
      toolOutcomes,
      confirmationPrerequisiteTools:
        engineState.plan.turnPolicy.confirmationPrerequisiteTools,
      completionToolHints: engineState.plan.turnPolicy.completionToolHints,
      userMessage: input.message.body ?? "",
    });

    engineState = engine.refreshTurnWithBehavior(engineState, input.behaviorConfig, {
      toolOutcomes,
      memory: { ...(memSnap as Record<string, unknown>), flowSlots: persistedSlots },
      phase: "validate",
    });
    const eilEnabled = engineState.turnContext.eilEnabled;
    if (eilEnabled && engineState.turnContext.eilSnapshot) {
      traceBuilder.setEilSnapshot(engineState.turnContext.eilSnapshot);
    }

    let slotsToPersist = buildPersistedFlowSlots({
      baseFlowSlots: persistedSlots,
      toolOutcomes,
      eilFacts: eilEnabled ? engineState.turnContext.facts : undefined,
    });
    slotsToPersist = applyConfirmationPhaseTransitions({
      baseFlowSlots: slotsToPersist,
      toolOutcomes,
      confirmationPrerequisiteTools:
        engineState.plan.turnPolicy.confirmationPrerequisiteTools,
      completionToolHints: engineState.plan.turnPolicy.completionToolHints,
      userMessage: input.message.body ?? "",
    });
    if (Object.keys(slotsToPersist).length > 0) {
      try {
        await mergeFlowSlotsAutomationContext({
          organizationId: input.organizationId,
          conversationId: input.conversation.id,
          botId: input.bot.id,
          flowSlots: slotsToPersist,
        });
      } catch {
        /* best-effort */
      }
    }

    let validationOk = true;
    let validationAlerts: string[] = [];
    if (toolOutcomes.length > 0) {
      traceBuilder.startNode("validate_result", "Validar ferramentas");
      const turnPolicy = engineState.plan.turnPolicy;
      const requiredToolNames = engineState.plan.requiredToolNames;
      const validation = validateToolExecution({
        toolOutcomes,
        replyText: reply,
        strictMode: input.engineConfig.strictMode,
        requiredToolNames,
        turnPolicy,
        behaviorConfig: input.behaviorConfig,
        userMessage: input.message.body ?? "",
        capabilityGraph: engineState.turnContext.capabilityGraph,
        factsBeforeTurn: engineState.turnContext.facts,
      });
      validationOk = validation.ok;
      validationAlerts = validation.alerts;
      if (!validation.ok) {
        for (const a of validation.alerts) traceBuilder.addError(a);
        input.executionLog?.warn(
          { id: "tool_validator", name: "Tool Validator" },
          validation.alerts.join("; "),
        );
        try {
          const reverted = await maybeRevertIllegalHandoffAfterValidation({
            organizationId: input.organizationId,
            conversationId: input.conversation.id,
            toolOutcomes,
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
          /* best-effort */
        }
      }
      traceBuilder.endNode("validate_result", validation.ok ? "ok" : "warn", validation.alerts.join("; "));
    }

    engineState = engine.finalize(engineState, "openconduit");
    const snap = engine.snapshot(engineState);
    for (const entry of timelineToInspectorEntries(engineState.timeline)) {
      input.executionLog?.info(
        { id: entry.id, name: entry.name },
        entry.message,
      );
    }

    input.executionLog?.info(
      { id: "agent_engine", name: "Agent Engine" },
      JSON.stringify({
        runtime: "openconduit",
        strict: input.engineConfig.strictMode,
        eil: eilEnabled,
        engine: {
          intent: snap.intentKind,
          required: snap.plan.requiredToolNames,
          pending: snap.contract.pendingToolNames,
          metrics: snap.metrics,
        },
      }),
    );

    const gate = runWorkflowGate({
      engineConfig: input.engineConfig,
      behaviorConfig: input.behaviorConfig,
      userMessage: input.message.body ?? "",
      replyText: reply,
      toolOutcomes,
      kbMeta: execResult.kbMeta ?? { hasUsefulExcerpts: false, coversQuery: false },
      memorySnapshot: { ...(memSnap as Record<string, unknown>), flowSlots: persistedSlots },
      graphNodeSequence: ["load_memory", "schedule_tools", "respond"],
      eilSnapshot: engineState.turnContext.eilSnapshot,
      turnPlan: engineState.turnContext.turnPlan,
    });
    if (gate.advisoryFailures > 0 || (gate.report && !gate.report.approved)) {
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
    }

    const blockOutbound = shouldBlockOutboundFromTurnContract({
      strictMode: input.engineConfig.strictMode,
      validationBlockSend: !validationOk && validationAlerts.some((a) => /proibid|block/i.test(a)),
      retryCount: 0,
      canRetry: false,
      executionContract: engineState.turnContext.executionContract,
      toolOutcomes,
    });
    let outboundReply = reply;
    if (blockOutbound) {
      const reason = blockReasonFromTurnContract({
        strictMode: input.engineConfig.strictMode,
        validationBlockSend: !validationOk,
        retryCount: 0,
        canRetry: false,
        executionContract: engineState.turnContext.executionContract,
        toolOutcomes,
      });
      input.executionLog?.warn(
        { id: "turn_contract_gate", name: "Turn Contract Gate" },
        `Outbound bloqueado — ${reason}`,
      );
      outboundReply = "";
    }

    const builtTrace = traceBuilder.build();
    if (input.engineConfig.otelEnabled && builtTrace) {
      void ingestAgentTraceToOtel(builtTrace, {
        enabled: true,
        turnId: `${input.conversation.id}:${input.message.id}`,
      });
    }

    return { reply: outboundReply, trace: builtTrace, toolOutcomes };
  }
}
