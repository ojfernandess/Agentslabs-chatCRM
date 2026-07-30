/**
 * @deprecated Production path for Motor Padrão / LangGraph no longer uses this orchestrator.
 * Motor Padrão = linear sandbox (`generateNativeAgentReplyCore`); LangGraph = StateGraph agent↔tools.
 * Kept for simulator / legacy unit tests of EIL + ReplySynthesizer spine.
 */
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider as defaultCreateMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import { runWorkflowGate } from "../audit/applyWorkflowGate.js";
import { flowSlotsFromMemory } from "../eil/runtimeBridge.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import {
  applyConfirmationPhaseTransitions,
  buildPersistedFlowSlots,
} from "../core/sessionToolOutcomes.js";
import { SESSION_WORKFLOW_PHASE_KEY } from "../continuation/implicitTurnWorkflow.js";
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
import {
  advanceImplicitWorkflowPhase,
  materializeImplicitWorkflowRun,
} from "../continuation/implicitTurnWorkflow.js";
import { ingestAgentTraceToOtel } from "../observability/OtelBridge.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { ensureDeliveringReply } from "../reply/ReplySynthesizer.js";
import { isNonDeliveringAgentReply } from "../reply/ReplyQuality.js";
import { logActProgress, resolveActProgressMessage } from "./ProgressEmitter.js";

export type ToolOutcomeRow = {
  name: string;
  ok: boolean;
  preview: string;
  structuredPayload?: unknown;
};

/** Resolve modo efectivo de execução de tools para o Motor Padrão. */
export function resolveEffectiveToolExecutionMode(
  input: AgentRuntimeExecuteInput,
): "runtime_owned" | "hybrid" {
  const hint = input.executionHints?.toolExecutionMode;
  if (hint === "runtime_owned" || hint === "hybrid") return hint;
  const cfg = input.engineConfig.toolExecutionMode;
  if (cfg === "runtime_owned" || cfg === "hybrid") {
    if (cfg === "runtime_owned" && input.engineConfig.schedulerEnabled !== true) {
      return "hybrid";
    }
    return cfg;
  }
  if (
    input.engineConfig.runtime === "openconduit" &&
    input.engineConfig.schedulerEnabled === true
  ) {
    return "runtime_owned";
  }
  return "hybrid";
}

function mergeToolOutcomes(a: ToolOutcomeRow[], b: ToolOutcomeRow[]): ToolOutcomeRow[] {
  const merged: ToolOutcomeRow[] = [];
  for (const o of [...b, ...a]) {
    const key = o.name.trim().toLowerCase();
    const existing = merged.find((m) => m.name.trim().toLowerCase() === key);
    if (!existing) {
      merged.push(o);
      continue;
    }
    if (!existing.ok && o.ok) {
      merged[merged.indexOf(existing)] = o;
    }
  }
  return merged;
}

async function runSchedulerOnce(
  input: AgentRuntimeExecuteInput,
  engineState: EngineTurnState,
  memSnap: Record<string, unknown>,
  existing: ToolOutcomeRow[],
): Promise<{ outcomes: ToolOutcomeRow[]; appendix: string; planned: string[] }> {
  const plan = planScheduledToolInvocations(engineState.turnContext, existing);
  if (plan.length === 0) {
    return { outcomes: existing, appendix: "", planned: [] };
  }
  const scheduled = await invokeScheduledTools({
    organizationId: input.organizationId,
    bot: input.bot,
    conversation: input.conversation,
    message: input.message,
    log: input.log,
    behaviorConfig: input.behaviorConfig,
    turnContext: engineState.turnContext,
    existingOutcomes: existing,
    userMessage: input.message.body ?? "",
  });
  const outcomes = mergeToolOutcomes(
    existing,
    scheduled.outcomes.map(({ name, ok, preview, structuredPayload }) => ({
      name,
      ok,
      preview,
      structuredPayload,
    })),
  );
  const appendix = formatScheduledToolsSystemAppendix(
    outcomes.map((o) => ({
      name: o.name,
      ok: o.ok,
      preview: o.preview,
      structuredPayload: o.structuredPayload,
    })),
  );
  return { outcomes, appendix, planned: plan.map((p) => p.toolName) };
}

/**
 * Workflow Runtime Orchestrator — spine do Motor Padrão.
 * Workflow → Planner → Contract → Scheduler → Tools → Facts → LLM → Supervisor → Reply
 */
export async function runWorkflowRuntimeTurn(
  input: AgentRuntimeExecuteInput,
  executor: NativeAgentExecutor,
  opts?: {
    runtimeLabel?: "openconduit" | "langgraph";
    createMemoryProvider?: typeof defaultCreateMemoryProvider;
  },
): Promise<AgentRuntimeExecuteResult> {
  const runtimeLabel = opts?.runtimeLabel ?? "openconduit";
  const memoryFactory = opts?.createMemoryProvider ?? defaultCreateMemoryProvider;
  const engine = sharedExecutionEngine;
  const toolMode = resolveEffectiveToolExecutionMode(input);
  const maxLoops = Math.max(
    1,
    (input.engineConfig.resilienceEnabled ? 2 : 1) + (input.engineConfig.strictMode ? 1 : 0),
  );

  const traceBuilder = new ExecutionTraceBuilder({
    runtime: runtimeLabel,
    memory: input.engineConfig.memory,
    strictMode: input.engineConfig.strictMode,
    observability: input.engineConfig.observability,
  });

  traceBuilder.startNode("load_memory", "Carregar memória");
  const memory = memoryFactory(input.engineConfig.memory);
  const memSnap = (await memory.load(input.conversation.id, input.organizationId)) as Record<
    string,
    unknown
  >;
  traceBuilder.setMemorySnapshot(memSnap);
  traceBuilder.endNode("load_memory");

  let engineState: EngineTurnState = engine.beginTurn({
    input,
    memory: memSnap,
  });
  traceBuilder.emitEvent("turn_context", "ExecutionEngine beginTurn", {
    metadata: {
      intent: engineState.turnContext.intent.kind,
      requiredTools: engineState.contract.requiredToolNames,
      contractValid: engineState.contract.valid,
      promptHash: engineState.turnContext.promptContract.promptHash,
      toolExecutionMode: toolMode,
    },
  });

  // --- Workflow (explícito ou implícito) ---
  const tWf = Date.now();
  const continuation = await runContinuationIfEnabled({
    engineConfig: input.engineConfig,
    behaviorConfig: input.behaviorConfig as Record<string, unknown>,
    organizationId: input.organizationId,
    conversationId: input.conversation.id,
    userMessage: input.message.body ?? "",
    vars: {
      facts: engineState.turnContext.facts,
      flowSlots: flowSlotsFromMemory(memSnap),
    },
  });

  let workflowImplicit = false;
  if (continuation.enabled && continuation.state) {
    engineState = engine.attachWorkflow(engineState, continuation.state);
  } else {
    workflowImplicit = true;
    const implicit = materializeImplicitWorkflowRun({
      organizationId: input.organizationId,
      conversationId: input.conversation.id,
      messageId: input.message.id,
      requiredToolNames: engineState.plan.requiredToolNames,
      userMessage: input.message.body ?? "",
    });
    engineState = engine.attachWorkflow(engineState, implicit.state);
  }

  engineState = engine.replanWithWorkflow(engineState, input.behaviorConfig, {
    memory: memSnap,
  });

  engineState = engine.recordPhase(
    engineState,
    "workflow",
    `${engineState.workflowRun?.status}:${engineState.workflowRun?.currentStepId ?? "done"}`,
    {
      implicit: workflowImplicit,
      resumed: continuation.resumed,
      workflowId: engineState.workflowRun?.workflowId,
      plannedTools: engineState.workflowRun?.plannedToolNames,
      suspendReason: engineState.workflowRun?.suspendReason,
    },
    Date.now() - tWf,
  );
  input.executionLog?.info(
    { id: "workflow_engine", name: "Workflow Step Engine" },
    JSON.stringify({
      implicit: workflowImplicit,
      resumed: continuation.resumed,
      status: engineState.workflowRun?.status,
      currentStepId: engineState.workflowRun?.currentStepId,
      plannedToolNames: engineState.workflowRun?.plannedToolNames,
    }),
  );
  traceBuilder.emitEvent("workflow_engine", "Workflow controls turn", {
    metadata: {
      implicit: workflowImplicit,
      plannedTools: engineState.workflowRun?.plannedToolNames,
      requiredAfterMerge: engineState.plan.requiredToolNames,
    },
  });

  let toolOutcomes: ToolOutcomeRow[] = [];
  let scheduledAppendix = "";
  let reply = "";
  let execResult: Awaited<ReturnType<NativeAgentExecutor>> = {
    reply: "",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  };
  let validationOk = true;
  let validationAlerts: string[] = [];
  let validationBlockSend = false;
  let retryCount = 0;
  let previousReply = "";
  let supervisorApproved = true;

  const canSchedule = shouldRunToolScheduler(input.engineConfig, input.executionHints);

  // Spine: PLAN (beginTurn acima) → ACT → OBSERVE → REPLY → VALIDATE
  for (let loop = 0; loop < maxLoops; loop++) {
    // --- ACT: Tool Scheduler owns required tools ---
    if (canSchedule) {
      const t0 = Date.now();
      if (loop === 0) {
        traceBuilder.startNode("schedule_tools", "Tool Scheduler");
      } else {
        traceBuilder.startNode("schedule_tools", "Tool Scheduler (recovery)");
      }
      const planPreview = planScheduledToolInvocations(engineState.turnContext, toolOutcomes);
      const actProgress = resolveActProgressMessage({
        toolExecutionMode: toolMode,
        plannedToolNames: planPreview.map((p) => p.toolName),
        behaviorConfig: input.behaviorConfig,
      });
      logActProgress(
        input,
        actProgress,
        planPreview.map((p) => p.toolName),
      );
      const scheduled = await runSchedulerOnce(input, engineState, memSnap, toolOutcomes);
      toolOutcomes = scheduled.outcomes;
      scheduledAppendix = scheduled.appendix || scheduledAppendix;
      engineState = engine.refreshTurnWithBehavior(engineState, input.behaviorConfig, {
        toolOutcomes,
        memory: memSnap,
        phase: loop === 0 ? "schedule" : "recover",
      });
      if (engineState.workflowRun && workflowImplicit) {
        engineState = engine.attachWorkflow(
          engineState,
          advanceImplicitWorkflowPhase(engineState.workflowRun, "facts"),
        );
      }
      input.executionLog?.info(
        { id: "tool_scheduler", name: "Tool Scheduler" },
        JSON.stringify({
          loop,
          planned: scheduled.planned,
          executed: toolOutcomes.map((o) => o.name),
          recoveryCount: engineState.recoveryCount,
          phase: "ACT",
        }),
      );
      engineState = engine.recordPhase(
        engineState,
        loop === 0 ? "schedule" : "recover",
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

    // --- OBSERVE: pending required after schedule → recover before REPLY ---
    const pendingAfterSchedule = engineState.contract.pendingToolNames ?? [];
    if (
      canSchedule &&
      pendingAfterSchedule.length > 0 &&
      loop < maxLoops - 1 &&
      (input.engineConfig.resilienceEnabled || input.engineConfig.strictMode)
    ) {
      const decision = engine.decideRecovery({
        engineConfig: input.engineConfig,
        behaviorConfig: input.behaviorConfig,
        executionContract: engineState.contract,
        retryCount,
        recoveryCount: engineState.recoveryCount,
        toolOutcomes,
      });
      if (decision.action === "recover_mandatory_tools") {
        engineState = engine.bumpRecovery(engineState);
        input.executionLog?.info(
          { id: "tool_recovery", name: "Tool Recovery" },
          JSON.stringify({ action: decision.action, pending: decision.pendingToolNames }),
        );
        continue;
      }
    }

    // --- REPLY: LLM synthesizes from OBSERVE facts (runtime_owned = no tool calls) ---
    const tExec = Date.now();
    traceBuilder.startNode("respond", runtimeLabel === "langgraph" ? "Executar agente" : "OpenNexo Runtime");
    execResult = await executor({
      ...input,
      executionHints: {
        ...input.executionHints,
        toolExecutionMode: toolMode,
        replyOnlyRetry: loop > 0 && toolMode === "runtime_owned" ? true : input.executionHints?.replyOnlyRetry,
        preScheduledToolOutcomes:
          toolOutcomes.length > 0
            ? toolOutcomes
            : input.executionHints?.preScheduledToolOutcomes,
        priorSuccessfulToolOutcomes:
          toolOutcomes.filter((t) => t.ok).length > 0
            ? toolOutcomes.filter((t) => t.ok)
            : input.executionHints?.priorSuccessfulToolOutcomes,
      },
    });
    reply = execResult.reply;
    if (toolMode === "hybrid") {
      toolOutcomes = mergeToolOutcomes(toolOutcomes, execResult.toolOutcomes ?? []);
    }

    // Contrato duro: nunca enviar stall / «Invocando ferramenta» apos tools OK.
    const synthesized = ensureDeliveringReply({
      replyText: reply,
      toolOutcomes,
      userMessage: input.message.body ?? "",
    });
    if (synthesized.replaced) {
      input.executionLog?.warn(
        { id: "reply_synthesizer", name: "Reply Synthesizer" },
        JSON.stringify({
          reason: synthesized.reason,
          beforeChars: reply.length,
          afterChars: synthesized.reply.length,
        }),
      );
      reply = synthesized.reply;
      execResult = { ...execResult, reply };
    }

    engineState = engine.recordPhase(
      engineState,
      "execute_llm",
      scheduledAppendix ? "with_scheduler" : toolMode,
      { toolExecutionMode: toolMode, replySynthesized: synthesized.replaced },
      Date.now() - tExec,
    );
    traceBuilder.endNode("respond");

    if (engineState.workflowRun && workflowImplicit) {
      engineState = engine.attachWorkflow(
        engineState,
        advanceImplicitWorkflowPhase(engineState.workflowRun, "reply"),
      );
    }

    const baseSlots = flowSlotsFromMemory(memSnap);
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
      lastAssistantPreview: reply,
      clearPostCompletionPending: engineState.postCompletionFollowUp,
    });
    if (engineState.workflowRun?.currentStepId) {
      persistedSlots[SESSION_WORKFLOW_PHASE_KEY] = String(engineState.workflowRun.currentStepId);
    }

    engineState = engine.refreshTurnWithBehavior(engineState, input.behaviorConfig, {
      toolOutcomes,
      memory: { ...memSnap, flowSlots: persistedSlots },
      phase: "validate",
    });

    // --- VALIDATE ---
    validationOk = true;
    validationAlerts = [];
    validationBlockSend = false;
    if (toolOutcomes.length > 0 || engineState.plan.requiredToolNames.length > 0) {
      traceBuilder.startNode("validate_result", "Validar ferramentas");
      const validation = validateToolExecution({
        toolOutcomes,
        replyText: reply,
        strictMode: input.engineConfig.strictMode,
        requiredToolNames: engineState.plan.requiredToolNames,
        turnPolicy: engineState.plan.turnPolicy,
        behaviorConfig: input.behaviorConfig,
        userMessage: input.message.body ?? "",
        capabilityGraph: engineState.turnContext.capabilityGraph,
        factsBeforeTurn: engineState.turnContext.facts,
      });
      validationOk = validation.ok;
      validationAlerts = validation.alerts;
      validationBlockSend = validation.blockSend === true;
      if (!validation.ok) {
        for (const a of validation.alerts) traceBuilder.addError(a);
        input.executionLog?.warn(
          { id: "tool_validator", name: "Tool Validator" },
          validation.alerts.join("; "),
        );
        try {
          await maybeRevertIllegalHandoffAfterValidation({
            organizationId: input.organizationId,
            conversationId: input.conversation.id,
            toolOutcomes,
            validationAlerts: validation.alerts,
            turnPolicy: engineState.plan.turnPolicy,
          });
        } catch {
          /* best-effort */
        }
      }
      // Hard gate: narracao apos tools OK nunca sai (mesmo se validator soft)
      if (toolOutcomes.some((t) => t.ok) && isNonDeliveringAgentReply(reply)) {
        validationBlockSend = true;
        validationOk = false;
        if (!validationAlerts.some((a) => /espera|non-delivering|não entregue/i.test(a))) {
          validationAlerts.push(
            "Resposta de espera após tool com sucesso — possível resultado não entregue",
          );
        }
      }
      traceBuilder.endNode(
        "validate_result",
        validation.ok && !validationBlockSend ? "ok" : "warn",
        validationAlerts.join("; "),
      );
    }

    // Structural supervisor (Motor Padrão — sempre valida contrato quando resilience/supervisor)
    const runStructural =
      input.engineConfig.supervisorEnabled === true ||
      input.engineConfig.resilienceEnabled === true ||
      input.engineConfig.strictMode === true;
    let supervisorTrace = null as ReturnType<typeof buildSupervisorTrace> | null;
    if (runStructural) {
      traceBuilder.startNode("supervisor", "Supervisor estrutural");
      supervisorTrace = buildSupervisorTrace(
        buildSupervisorValidationInput({
          userMessage: input.message.body ?? "",
          replyText: reply,
          toolOutcomes,
          kbMeta: execResult.kbMeta ?? { hasUsefulExcerpts: false, coversQuery: false },
          strictMode: input.engineConfig.strictMode,
          memorySnapshot: { ...memSnap, flowSlots: persistedSlots },
          retryCount,
          previousReply: previousReply || undefined,
          llmApproved:
            input.engineConfig.supervisorMode === "llm" ||
            input.engineConfig.supervisorMode === "both"
              ? execResult.llmSupervisorApproved
              : undefined,
          llmSummary: execResult.llmSupervisorSummary,
          validationBlockSend,
          eilEnabled: engineState.turnContext.eilEnabled === true,
          eilPlan: engineState.turnContext.eilPlan,
          eilViolations: engineState.turnContext.eilSnapshot?.violations,
          eilRequiredFactsMissing: engineState.turnContext.eilPlan?.pendingFacts,
          turnPolicy: engineState.plan.turnPolicy,
          executionContract: engineState.contract,
        }),
      );
      supervisorApproved = supervisorTrace.approved;
      traceBuilder.endNode(
        "supervisor",
        supervisorTrace.approved ? "ok" : "warn",
        `${supervisorTrace.summary} · ${engine.decideRecovery({
          engineConfig: input.engineConfig,
          behaviorConfig: input.behaviorConfig,
          supervisorTrace,
          executionContract: engineState.contract,
          retryCount,
          recoveryCount: engineState.recoveryCount,
          previousReply,
          replyText: reply,
          toolOutcomes,
        }).action}`,
      );
      input.executionLog?.info(
        { id: "langgraph_supervisor", name: "Structural Supervisor" },
        JSON.stringify({
          approved: supervisorTrace.approved,
          summary: supervisorTrace.summary,
          checks: supervisorTrace.checks.map((c) => ({ id: c.id, passed: c.passed })),
        }),
      );
    } else {
      supervisorApproved = !(input.engineConfig.strictMode && validationBlockSend);
    }

    const decision = engine.decideRecovery({
      engineConfig: {
        ...input.engineConfig,
        resilienceEnabled:
          input.engineConfig.resilienceEnabled === true || input.engineConfig.strictMode === true,
      },
      behaviorConfig: input.behaviorConfig,
      supervisorTrace,
      executionContract: engineState.contract,
      retryCount,
      recoveryCount: engineState.recoveryCount,
      previousReply,
      replyText: reply,
      toolOutcomes,
    });

    if (
      loop < maxLoops - 1 &&
      (decision.action === "recover_mandatory_tools" ||
        decision.action === "reply_only_retry" ||
        (decision.action === "continue" &&
          supervisorTrace != null &&
          !supervisorApproved &&
          shouldRetryAfterSupervisor(supervisorTrace, input.engineConfig.strictMode, retryCount)))
    ) {
      if (decision.action === "recover_mandatory_tools") {
        engineState = engine.bumpRecovery(engineState);
      } else {
        retryCount += 1;
      }
      previousReply = reply;
      input.executionLog?.info(
        { id: "resilience", name: "Turn Resilience" },
        JSON.stringify({ action: decision.action, reason: decision.reason, loop }),
      );
      continue;
    }

    if (decision.action === "apply_fallback" && decision.fallbackMessage) {
      reply = decision.fallbackMessage;
    }
    if (decision.action === "block" && input.engineConfig.strictMode) {
      // recover-first already exhausted — keep reply unless empty; gate may clear later
      if (!reply.trim() && decision.fallbackMessage) reply = decision.fallbackMessage;
    }

    break;
  }

  const eilEnabled = engineState.turnContext.eilEnabled;
  if (eilEnabled && engineState.turnContext.eilSnapshot) {
    traceBuilder.setEilSnapshot(engineState.turnContext.eilSnapshot);
  }

  const baseSlotsFinal = flowSlotsFromMemory(memSnap);
  let slotsToPersist = buildPersistedFlowSlots({
    baseFlowSlots: baseSlotsFinal,
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
    lastAssistantPreview: reply,
    clearPostCompletionPending: engineState.postCompletionFollowUp,
  });
  if (engineState.workflowRun?.currentStepId) {
    slotsToPersist[SESSION_WORKFLOW_PHASE_KEY] = String(engineState.workflowRun.currentStepId);
  }
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

  if (engineState.workflowRun && workflowImplicit) {
    engineState = engine.attachWorkflow(
      engineState,
      advanceImplicitWorkflowPhase(engineState.workflowRun, "end"),
    );
  }

  engineState = engine.finalize(engineState, runtimeLabel);
  const snap = engine.snapshot(engineState);
  for (const entry of timelineToInspectorEntries(engineState.timeline)) {
    input.executionLog?.info({ id: entry.id, name: entry.name }, entry.message);
  }

  input.executionLog?.info(
    { id: "agent_engine", name: "Agent Engine" },
    JSON.stringify({
      runtime: runtimeLabel,
      orchestrator: "workflow_runtime",
      toolExecutionMode: toolMode,
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
    memorySnapshot: { ...memSnap, flowSlots: slotsToPersist },
    graphNodeSequence: ["load_memory", "workflow", "schedule_tools", "respond", "supervisor"],
    eilSnapshot: engineState.turnContext.eilSnapshot,
    turnPlan: engineState.turnContext.turnPlan,
    executionContract: engineState.contract,
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

  // Política dura (stall, conclusão inventada, pares proibidos) — mesmo sem strictMode.
  const hardPolicyBlock = validationBlockSend === true;
  const blockOutbound = shouldBlockOutboundFromTurnContract({
    strictMode: input.engineConfig.strictMode,
    validationBlockSend: hardPolicyBlock,
    retryCount,
    canRetry: false,
    executionContract: engineState.turnContext.executionContract,
    toolOutcomes,
    supervisorTrace: supervisorApproved
      ? { approved: true, summary: "ok", checks: [], retryCount }
      : undefined,
    recoverFirst: true,
  });
  let outboundReply = reply;
  if (blockOutbound && hardPolicyBlock) {
    const reason = blockReasonFromTurnContract({
      strictMode: input.engineConfig.strictMode,
      validationBlockSend: hardPolicyBlock,
      retryCount,
      canRetry: false,
      executionContract: engineState.turnContext.executionContract,
      toolOutcomes,
      recoverFirst: true,
    });
    input.executionLog?.warn(
      { id: "turn_contract_gate", name: "Turn Contract Gate" },
      `Outbound bloqueado — ${reason}`,
    );
    const claimsFakeCompletion =
      /check-in (foi )?conclu[ií]d|check[\s-]?in (realizad|efetuad|feito)/i.test(outboundReply);
    const checkInFailed = toolOutcomes.some(
      (t) => /check[_-]?in/i.test(t.name) && t.ok === false,
    );
    if (claimsFakeCompletion && checkInFailed) {
      outboundReply =
        "Não consegui concluir o check-in automaticamente — faltam dados obrigatórios no sistema. " +
        "Pode confirmar se o selfie e o documento já foram enviados, ou partilhar novamente os dados do titular?";
    } else if (!outboundReply.trim()) {
      outboundReply = "";
    }
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
