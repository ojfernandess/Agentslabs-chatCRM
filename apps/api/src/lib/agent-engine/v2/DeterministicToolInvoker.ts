/**
 * Deterministic Tool Invoker — Runtime escolhe a tool; LLM produz só argumentos JSON.
 * Fase 3: separa invocação de tools da geração de reply.
 */

import {
  callOpenAiCompatibleChatWithTools,
  type OpenAiToolDefinition,
  type PreviewChatTurn,
} from "../../promptModulePreviewLlm.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { isSkippedToolOutcome } from "../validators/turnPolicyParser.js";
import {
  buildSchedulerPromptBlock,
  resolveOpenAiFunctionName,
  scheduleNextAction,
  type ToolSchedulerDecision,
} from "./ToolScheduler.js";
import type { RuntimeV2Session } from "./RuntimeV2Bridge.js";
import { refreshRuntimeV2Orchestrator } from "./RuntimeV2Bridge.js";

export type DeterministicToolPhaseResult = {
  toolsInvoked: number;
  lastDecision: ToolSchedulerDecision | null;
  /** Tools obrigatórias que o LLM não invocou mesmo após retry/fallback. */
  missedMandatory: string[];
};

export type RunDeterministicToolPhaseOpts = {
  session: RuntimeV2Session;
  allTools: OpenAiToolDefinition[];
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  availableToolNames: string[];
  replyOnlyRetry?: boolean;
  /** Contexto mínimo para args (flow slots, etc.) — não o playbook completo. */
  argsContextAppend?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  history: PreviewChatTurn[];
  userMessage: string;
  onToolCall: (name: string, argsJson: string) => Promise<string>;
  signal?: AbortSignal;
  maxMandatoryTools?: number;
  onRound?: (input: { decision: ToolSchedulerDecision; round: number }) => void;
};

const ARGS_ONLY_SYSTEM =
  "[OpenConduit — Deterministic Tool Invoker]\n" +
  "O Runtime já escolheu a ferramenta. Produza **apenas** a chamada function com argumentos JSON válidos.\n" +
  "**PROIBIDO** escrever texto ao cliente nesta ronda.\n" +
  "Use o histórico e a mensagem do utilizador para preencher os argumentos correctamente.\n";

const RETRY_SYSTEM_APPEND =
  "\n\n**RETRY:** A ronda anterior não invocou a ferramenta. Invoca **obrigatoriamente** a function indicada — sem texto ao cliente.\n";

/** True quando o scheduler agenda tool obrigatória com tool_choice forçado. */
export function shouldRunDeterministicToolPhase(decision: ToolSchedulerDecision): boolean {
  return (
    decision.phase === "invoke_tool" &&
    Boolean(decision.scheduledTool) &&
    decision.blockTextReply &&
    decision.toolChoice !== "auto" &&
    decision.toolChoice !== "none"
  );
}

function mandatoryToolSatisfied(
  scheduledTool: string,
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>,
  sinceIndex: number,
): boolean {
  const slice = toolOutcomes.slice(sinceIndex);
  const effective = slice.filter((t) => t.ok && !isSkippedToolOutcome(t.preview));
  if (effective.length === 0) return false;
  return effective.some((t) =>
    toolOutcomeSatisfiesRequired(scheduledTool, [{ name: t.name, preview: t.preview ?? "" }]),
  );
}

/** Invocação directa pelo runtime quando o LLM ignora tool_choice: required. */
export async function invokeMandatoryToolDirect(
  scheduledTool: string,
  allTools: OpenAiToolDefinition[],
  onToolCall: (name: string, argsJson: string) => Promise<string>,
): Promise<boolean> {
  const fnName = resolveOpenAiFunctionName(scheduledTool, allTools);
  if (!fnName) return false;
  await onToolCall(fnName, "{}");
  return true;
}

/**
 * Executa fase determinística: para cada tool obrigatória agendada, LLM gera args → Runtime invoca.
 * Se o LLM não devolver tool_calls, retry + fallback de invocação directa.
 */
export async function runDeterministicToolPhase(
  opts: RunDeterministicToolPhaseOpts,
): Promise<DeterministicToolPhaseResult> {
  const maxTools = Math.max(1, Math.min(opts.maxMandatoryTools ?? 4, 8));
  let session = opts.session;
  let toolsInvoked = 0;
  let lastDecision: ToolSchedulerDecision | null = null;
  const missedMandatory: string[] = [];

  for (let round = 0; round < maxTools; round++) {
    session = refreshRuntimeV2Orchestrator(session, opts.availableToolNames, opts.toolOutcomes);
    const decision = scheduleNextAction({
      session,
      allTools: opts.allTools,
      toolOutcomes: opts.toolOutcomes,
      replyOnlyRetry: opts.replyOnlyRetry,
    });
    lastDecision = decision;

    if (!shouldRunDeterministicToolPhase(decision) || !decision.scheduledTool) {
      break;
    }

    opts.onRound?.({ decision, round });

    const scheduledTool = decision.scheduledTool;
    const fnName =
      typeof decision.toolChoice === "object"
        ? decision.toolChoice.function.name
        : resolveOpenAiFunctionName(scheduledTool, opts.allTools);

    const singleTool = fnName
      ? decision.activeTools.filter((t) => t.function.name === fnName)
      : decision.activeTools.slice(0, 1);

    if (singleTool.length === 0) break;

    const outcomeBefore = opts.toolOutcomes.length;
    let satisfied = false;

    for (let attempt = 0; attempt < 2 && !satisfied; attempt++) {
      const system =
        ARGS_ONLY_SYSTEM +
        (attempt > 0 ? RETRY_SYSTEM_APPEND : "") +
        (opts.argsContextAppend ?? "") +
        buildSchedulerPromptBlock(decision);

      const result = await callOpenAiCompatibleChatWithTools({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        temperature: Math.min(opts.temperature, attempt > 0 ? 0.1 : 0.3),
        maxTokens: Math.max(64, Math.min(opts.maxTokens, 1024)),
        system,
        history: opts.history,
        userMessage: opts.userMessage,
        tools: singleTool,
        toolChoice:
          typeof decision.toolChoice === "object"
            ? decision.toolChoice
            : { type: "function", function: { name: singleTool[0]!.function.name } },
        maxToolRounds: 1,
        onToolCall: opts.onToolCall,
        signal: opts.signal,
      });

      satisfied = mandatoryToolSatisfied(scheduledTool, opts.toolOutcomes, outcomeBefore);
      if (!satisfied && result.toolRounds === 0 && attempt === 1) {
        await invokeMandatoryToolDirect(scheduledTool, opts.allTools, opts.onToolCall);
        satisfied = mandatoryToolSatisfied(scheduledTool, opts.toolOutcomes, outcomeBefore);
      }
    }

    if (satisfied) {
      toolsInvoked++;
    } else {
      missedMandatory.push(scheduledTool);
      break;
    }

    session = refreshRuntimeV2Orchestrator(session, opts.availableToolNames, opts.toolOutcomes);
  }

  return { toolsInvoked, lastDecision, missedMandatory };
}

/** Recuperação pós-LLM: invoca tool obrigatória pendente directamente. */
export async function recoverMissedMandatoryTool(opts: {
  session: RuntimeV2Session;
  allTools: OpenAiToolDefinition[];
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>;
  availableToolNames: string[];
  replyOnlyRetry?: boolean;
  onToolCall: (name: string, argsJson: string) => Promise<string>;
}): Promise<{ recovered: boolean; scheduledTool: string | null }> {
  const session = refreshRuntimeV2Orchestrator(
    opts.session,
    opts.availableToolNames,
    opts.toolOutcomes,
  );
  const decision = scheduleNextAction({
    session,
    allTools: opts.allTools,
    toolOutcomes: opts.toolOutcomes,
    replyOnlyRetry: opts.replyOnlyRetry,
  });
  if (!shouldRunDeterministicToolPhase(decision) || !decision.scheduledTool) {
    return { recovered: false, scheduledTool: null };
  }
  const before = opts.toolOutcomes.length;
  await invokeMandatoryToolDirect(decision.scheduledTool, opts.allTools, opts.onToolCall);
  const recovered = mandatoryToolSatisfied(decision.scheduledTool, opts.toolOutcomes, before);
  return { recovered, scheduledTool: decision.scheduledTool };
}
