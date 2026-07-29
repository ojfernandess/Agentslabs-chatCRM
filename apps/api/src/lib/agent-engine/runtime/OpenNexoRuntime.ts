import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { ExecutionTraceBuilder } from "../observability/ExecutionTrace.js";
import { createMemoryProvider } from "../memory/MemoryProvider.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { maybeRevertIllegalHandoffAfterValidation } from "../../agentConversationHandoff.js";
import { resolveRequiredToolNamesForValidation, runWorkflowGate } from "../audit/applyWorkflowGate.js";
import { resolveTurnPolicy } from "../validators/turnPolicyParser.js";
import { resolveEilTurn, flowSlotsFromMemory } from "../eil/runtimeBridge.js";
import { mergeFlowSlotsAutomationContext } from "../../automationConversationContextLib.js";
import {
  buildPersistedFlowSlots,
  priorToolOutcomesFromSession,
} from "../core/sessionToolOutcomes.js";

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
 * Runtime padrão — delega ao pipeline nativo existente (`generateNativeAgentReplyCore`).
 * Persiste tools OK em flowSlots para confirmações multi-turno (sim → pré-requisito → conclusão).
 */
export class OpenNexoRuntime implements AgentRuntime {
  readonly kind = "openconduit" as const;

  constructor(private readonly executor: NativeAgentExecutor) {}

  async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
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

    traceBuilder.startNode("respond", "OpenNexo Runtime");
    const { reply, toolOutcomes = [] } = await this.executor(input);
    traceBuilder.endNode("respond");

    const baseSlots = flowSlotsFromMemory(memSnap as Record<string, unknown>);
    const persistedSlots = buildPersistedFlowSlots({
      baseFlowSlots: baseSlots,
      toolOutcomes,
    });

    const eil = resolveEilTurn({
      behaviorConfig: input.behaviorConfig,
      userMessage: input.message.body ?? "",
      memory: { ...memSnap, flowSlots: persistedSlots },
      toolOutcomes,
      replyText: reply,
    });
    if (eil.enabled) {
      traceBuilder.setEilSnapshot(eil.snapshot);
    }

    // Tools OK da sessão + facts EIL; __satisfiedToolNames não é sobrescrito pelo EIL.
    const slotsToPersist = buildPersistedFlowSlots({
      baseFlowSlots: persistedSlots,
      toolOutcomes,
      eilFacts: eil.enabled ? eil.facts : undefined,
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

    if (toolOutcomes.length > 0) {
      traceBuilder.startNode("validate_result", "Validar ferramentas");
      const priorToolOutcomes = priorToolOutcomesFromSession(persistedSlots);
      const requiredToolNames = resolveRequiredToolNamesForValidation(input.behaviorConfig, {
        userMessage: input.message.body ?? "",
      });
      const turnPolicy = resolveTurnPolicy(input.behaviorConfig, {
        userMessage: input.message.body ?? "",
        priorToolOutcomes,
      });
      const validation = validateToolExecution({
        toolOutcomes,
        replyText: reply,
        strictMode: input.engineConfig.strictMode,
        requiredToolNames,
        turnPolicy,
        behaviorConfig: input.behaviorConfig,
        userMessage: input.message.body ?? "",
      });
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

    input.executionLog?.info(
      { id: "agent_engine", name: "Agent Engine" },
      JSON.stringify({ runtime: "openconduit", strict: input.engineConfig.strictMode, eil: eil.enabled }),
    );

    const gate = runWorkflowGate({
      engineConfig: input.engineConfig,
      behaviorConfig: input.behaviorConfig,
      userMessage: input.message.body ?? "",
      replyText: reply,
      toolOutcomes,
      kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
      memorySnapshot: { ...memSnap, flowSlots: persistedSlots },
      graphNodeSequence: ["load_memory", "respond"],
      eilSnapshot: eil.snapshot,
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

    return { reply, trace: traceBuilder.build() };
  }
}
