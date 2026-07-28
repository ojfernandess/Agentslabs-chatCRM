/**
 * Deterministic Tool Invoker — Runtime escolhe a tool; LLM produz só argumentos JSON.
 * Fase 3: separa invocação de tools da geração de reply.
 */

import {
  callOpenAiCompatibleChatWithTools,
  type OpenAiToolDefinition,
  type PreviewChatTurn,
} from "../../promptModulePreviewLlm.js";
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

/**
 * Executa fase determinística: para cada tool obrigatória agendada, LLM gera args → Runtime invoca.
 */
export async function runDeterministicToolPhase(
  opts: RunDeterministicToolPhaseOpts,
): Promise<DeterministicToolPhaseResult> {
  const maxTools = Math.max(1, Math.min(opts.maxMandatoryTools ?? 4, 8));
  let session = opts.session;
  let toolsInvoked = 0;
  let lastDecision: ToolSchedulerDecision | null = null;

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

    const fnName =
      typeof decision.toolChoice === "object"
        ? decision.toolChoice.function.name
        : resolveOpenAiFunctionName(decision.scheduledTool, opts.allTools);

    const singleTool = fnName
      ? decision.activeTools.filter((t) => t.function.name === fnName)
      : decision.activeTools.slice(0, 1);

    if (singleTool.length === 0) break;

    const system =
      ARGS_ONLY_SYSTEM +
      (opts.argsContextAppend ?? "") +
      buildSchedulerPromptBlock(decision);

    await callOpenAiCompatibleChatWithTools({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      temperature: Math.min(opts.temperature, 0.3),
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

    toolsInvoked++;
    session = refreshRuntimeV2Orchestrator(session, opts.availableToolNames, opts.toolOutcomes);
  }

  return { toolsInvoked, lastDecision };
}
