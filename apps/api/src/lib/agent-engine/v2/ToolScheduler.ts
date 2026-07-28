/**
 * Tool Scheduler — decide deterministicamente a próxima acção do turno.
 * O Runtime escolhe tools; o LLM só produz argumentos (ou reply na fase final).
 */

import type { OpenAiToolDefinition } from "../../promptModulePreviewLlm.js";
import { filterToolsByOrchestrator } from "./ToolOrchestrator.js";
import type { RuntimeV2Session } from "./RuntimeV2Bridge.js";
import type { ToolOrchestratorDecision } from "./types.js";

export type ToolSchedulerPhase = "invoke_tool" | "generate_reply";

export type ToolSchedulerDecision = {
  phase: ToolSchedulerPhase;
  /** Tool que o runtime agenda a seguir (null = livre dentro do allowlist). */
  scheduledTool: string | null;
  /** OpenAI tool_choice — required quando scheduledTool definido. */
  toolChoice: "auto" | "none" | { type: "function"; function: { name: string } };
  /** Tools visíveis ao LLM nesta ronda. */
  activeTools: OpenAiToolDefinition[];
  reason: string;
  /** Bloquear resposta textual enquanto tools pendentes. */
  blockTextReply: boolean;
};

export type ScheduleToolsOpts = {
  session: RuntimeV2Session;
  allTools: OpenAiToolDefinition[];
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  replyOnlyRetry?: boolean;
};

/** Resolve nome OpenAI function a partir do scheduled tool (canonical ou oc_tool_). */
export function resolveOpenAiFunctionName(
  scheduledTool: string,
  allTools: OpenAiToolDefinition[],
): string | null {
  const target = scheduledTool.toLowerCase().replace(/-/g, "_");
  for (const t of allTools) {
    const fn = t.function.name.toLowerCase();
    if (fn === target || fn.includes(target) || target.includes(fn)) {
      return t.function.name;
    }
  }
  return allTools.find((t) => t.function.name.toLowerCase() === target)?.function.name ?? null;
}

/**
 * Agenda próxima acção: invocar tool obrigatória (args via LLM) ou gerar reply.
 */
export function scheduleNextAction(opts: ScheduleToolsOpts): ToolSchedulerDecision {
  const { session, allTools, toolOutcomes, replyOnlyRetry } = opts;
  const orchestrator = session.orchestrator;
  const allowed = filterToolsByOrchestrator(allTools, orchestrator);

  if (replyOnlyRetry) {
    return {
      phase: "generate_reply",
      scheduledTool: null,
      toolChoice: "none",
      activeTools: [],
      reason: "Reply-only retry — sem tool rounds",
      blockTextReply: false,
    };
  }

  const mandatory = orchestrator.mandatoryNextTool;
  const pending = orchestrator.pendingRequired;

  if (mandatory && pending.length > 0) {
    const fnName = resolveOpenAiFunctionName(mandatory, allTools);
    const singleTool = fnName
      ? allowed.filter((t) => t.function.name === fnName)
      : allowed.filter((t) => {
          const fn = t.function.name.toLowerCase();
          const m = mandatory.toLowerCase();
          return fn === m || fn.includes(m) || m.includes(fn);
        });

    const activeTools = singleTool.length > 0 ? singleTool : allowed;
    const forcedFn = singleTool[0]?.function.name ?? fnName;

    return {
      phase: "invoke_tool",
      scheduledTool: mandatory,
      toolChoice: forcedFn
        ? { type: "function", function: { name: forcedFn } }
        : "auto",
      activeTools,
      reason: `Scheduler: invocar \`${mandatory}\` antes de responder`,
      blockTextReply: true,
    };
  }

  if (pending.length > 0 && session.contract.plan.phase === "tools") {
    return {
      phase: "invoke_tool",
      scheduledTool: pending[0] ?? null,
      toolChoice: "auto",
      activeTools: allowed,
      reason: `Scheduler: tools pendentes (${pending.join(", ")})`,
      blockTextReply: true,
    };
  }

  return {
    phase: "generate_reply",
    scheduledTool: null,
    toolChoice: allowed.length > 0 ? "auto" : "none",
    activeTools: allowed,
    reason: "Scheduler: plano de tools concluído — fase reply",
    blockTextReply: false,
  };
}

/** Prompt injectado quando scheduler força tool. */
export function buildSchedulerPromptBlock(decision: ToolSchedulerDecision): string {
  if (decision.phase !== "invoke_tool" || !decision.scheduledTool) return "";
  return (
    `\n\n[OpenConduit Tool Scheduler]\n` +
    `- **FASE:** invocar ferramenta — **PROIBIDO** responder ao hóspede nesta ronda.\n` +
    `- **Tool agendada:** \`${decision.scheduledTool}\` — produza apenas os argumentos correctos.\n` +
    `- Não escreva texto ao cliente até o Runtime concluir o plano de tools.\n`
  );
}

/** Atualiza decision do orchestrator após refresh. */
export function schedulerFromOrchestrator(
  orchestrator: ToolOrchestratorDecision,
  phase: ToolSchedulerPhase,
): Pick<ToolSchedulerDecision, "phase" | "scheduledTool" | "reason" | "blockTextReply"> {
  return {
    phase,
    scheduledTool: orchestrator.mandatoryNextTool,
    reason: orchestrator.reason,
    blockTextReply: phase === "invoke_tool" && orchestrator.pendingRequired.length > 0,
  };
}
