/**
 * Execution Contract Builder — contrato único antes de qualquer geração de resposta.
 */

import { randomUUID } from "node:crypto";
import { buildCapabilityGraph } from "../eil/CapabilityGraph.js";
import { factsFromFlowSlots, mergeFactStores } from "../eil/FactsEngine.js";
import { buildExecutionIntelligencePlan } from "../eil/ExecutionPlanner.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import { isConfirmationUserMessage } from "../validators/turnPolicyParser.js";
import { isContinuationSyntheticMessage } from "../continuation/constants.js";
import { compilePromptContract } from "./PromptCompiler.js";
import type {
  DetectedIntent,
  ExecutionContract,
  ExecutionPlan,
  PromptContract,
} from "./types.js";
import type { FactStore } from "../eil/types.js";

export type BuildExecutionContractOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
  lastAssistantMessage?: string;
  flowSlots?: Record<string, unknown>;
  priorFacts?: FactStore;
  toolsAlreadyCalled?: string[];
  systemPrompt?: string;
  /** Plano já calculado — evita re-parse divergente. */
  existingTurnPlan?: import("../planner/ExecutionTurnPlan.js").ExecutionTurnPlan;
};

function detectIntent(userMessage: string, turnPlan: { matchedPatternIds: string[]; knowledgeSeeking: boolean }): DetectedIntent {
  const isContinuation = isContinuationSyntheticMessage(userMessage);
  const isConfirmation = isConfirmationUserMessage(userMessage);
  const patternIds = [...turnPlan.matchedPatternIds];
  if (isContinuation && !patternIds.includes("proactive_continuation")) {
    patternIds.push("proactive_continuation");
  }
  const label =
    isContinuation
      ? "proactive_continuation"
      : isConfirmation
        ? "confirmation"
        : patternIds[0] ?? "general";
  return {
    patternIds,
    knowledgeSeeking: turnPlan.knowledgeSeeking,
    isConfirmation,
    isContinuation,
    label,
  };
}

function buildExecutionPlan(input: {
  requiredTools: string[];
  toolsAlreadyCalled: string[];
  turnPlan: { requiredToolNames: string[] };
}): ExecutionPlan {
  const called = new Set(input.toolsAlreadyCalled.map((t) => t.toLowerCase()));
  const pending = input.requiredTools.filter((t) => !called.has(t.toLowerCase()));
  const mandatoryNextTool = pending[0] ?? null;
  const completionCriteriaMet = pending.length === 0;
  const phase: ExecutionPlan["phase"] =
    pending.length > 0 ? "tools" : completionCriteriaMet ? "complete" : "reply";
  return {
    toolSequence: pending,
    mandatoryNextTool,
    phase,
    completionCriteriaMet,
  };
}

function deriveForbiddenTools(
  promptContract: PromptContract,
  turnPlan: { turnPolicy: { exclusiveAllowedTools: string[] | null; blockEscalation: boolean } },
  availableToolNames: string[],
): string[] {
  const forbidden = new Set<string>();
  const available = new Set(availableToolNames.map((a) => a.toLowerCase()));

  if (turnPlan.turnPolicy.exclusiveAllowedTools?.length) {
    for (const name of availableToolNames) {
      const allowed = turnPlan.turnPolicy.exclusiveAllowedTools.some(
        (a) => a.toLowerCase() === name.toLowerCase() || name.toLowerCase().includes(a.toLowerCase()),
      );
      if (!allowed) forbidden.add(name);
    }
  }

  if (turnPlan.turnPolicy.blockEscalation) {
    for (const name of availableToolNames) {
      if (/call_human|transfer_to_team|listar_equipas|set_conversation_status/i.test(name)) {
        forbidden.add(name);
      }
    }
  }

  return [...forbidden];
}

/**
 * Constrói Execution Contract completo.
 * Nenhuma resposta deve ser gerada sem contrato válido.
 */
export function buildExecutionContract(opts: BuildExecutionContractOpts): ExecutionContract {
  const userMessage = (opts.userMessage ?? "").trim();
  const availableToolNames = opts.availableToolNames ?? [];
  const toolsAlreadyCalled = opts.toolsAlreadyCalled ?? [];

  const promptContract = compilePromptContract({
    behaviorConfig: opts.behaviorConfig,
    systemPrompt: opts.systemPrompt,
  });

  const turnPlan =
    opts.existingTurnPlan ??
    buildExecutionTurnPlan({
      behaviorConfig: opts.behaviorConfig,
      userMessage,
      availableToolNames,
      lastAssistantMessage: opts.lastAssistantMessage,
    });

  const toolConfigs = availableToolNames.map((name) => ({ name }));
  const capabilityGraph = buildCapabilityGraph({ tools: toolConfigs });
  const facts = mergeFactStores(
    opts.priorFacts ?? {},
    factsFromFlowSlots(opts.flowSlots ?? {}),
  );

  const eilPlan = buildExecutionIntelligencePlan({
    behaviorConfig: opts.behaviorConfig,
    userMessage,
    availableToolNames,
    toolConfigs,
    facts,
    graph: capabilityGraph,
    toolsCalled: toolsAlreadyCalled,
    flowSlots: opts.flowSlots,
    lastAssistantMessage: opts.lastAssistantMessage,
    existingTurnPlan: turnPlan,
  });

  const intent = detectIntent(userMessage, turnPlan);
  const requiredTools = [...new Set([...turnPlan.requiredToolNames, ...eilPlan.pendingTools])];
  const optionalTools = promptContract.globalOptionalTools.filter(
    (t) => !requiredTools.includes(t) && availableToolNames.some((a) => a.toLowerCase().includes(t.toLowerCase())),
  );
  const forbiddenTools = deriveForbiddenTools(promptContract, turnPlan, availableToolNames);
  const plan = buildExecutionPlan({
    requiredTools,
    toolsAlreadyCalled,
    turnPlan,
  });

  const validationErrors: string[] = [];
  if (!promptContract.audit.loadedCompletely && (opts.systemPrompt?.length ?? 0) === 0) {
    validationErrors.push("Prompt contract: playbook não carregado completamente");
  }
  if (requiredTools.length > 0 && availableToolNames.length === 0) {
    validationErrors.push("Execution contract: ferramentas obrigatórias mas nenhuma tool disponível");
  }
  for (const req of requiredTools) {
    const reachable = availableToolNames.some(
      (a) => a.toLowerCase() === req.toLowerCase() || a.toLowerCase().includes(req.toLowerCase()),
    );
    if (!reachable && availableToolNames.length > 0) {
      validationErrors.push(`Tool obrigatória não disponível: ${req}`);
    }
  }

  const existingFacts = Object.keys(facts);
  const expectedFacts = eilPlan.requiredFacts ?? [];

  return {
    version: 2,
    contractId: randomUUID(),
    createdAt: new Date().toISOString(),
    intent,
    turnPlan,
    promptContract,
    eilPlan,
    capabilityGraph,
    facts,
    requiredTools,
    optionalTools,
    forbiddenTools,
    forbiddenPairs: turnPlan.turnPolicy.forbiddenSameTurnPairs,
    expectedFacts,
    existingFacts,
    constraints: [
      ...promptContract.restrictions.slice(0, 8),
      ...(eilPlan.forbiddenActions ?? []).map((a) => `forbidden:${a}`),
    ],
    capabilities: eilPlan.pendingCapabilities ?? [],
    plan,
    completionCriteria: promptContract.completionCriteria,
    valid: validationErrors.length === 0,
    validationErrors,
  };
}

/** Prompt block para o LLM — apenas argumentos, não escolha de tools. */
export function buildOrchestratorPromptBlock(decision: {
  mandatoryNextTool: string | null;
  pendingRequired: string[];
  forbiddenToolNames: string[];
}): string {
  const lines = [
    "\n\n[OpenConduit Runtime V2 — Tool Orchestrator]",
    "O Runtime controla a orquestração. Você produz **argumentos** para as ferramentas indicadas e a resposta final.",
    "- **PROIBIDO** invocar ferramentas fora da lista permitida pelo Runtime.",
  ];
  if (decision.mandatoryNextTool) {
    lines.push(`- **OBRIGATÓRIO** invocar a seguir: \`${decision.mandatoryNextTool}\` (antes de responder ao utilizador).`);
  } else if (decision.pendingRequired.length > 0) {
    lines.push(`- Ferramentas pendentes neste turno: ${decision.pendingRequired.join(", ")}.`);
  }
  if (decision.forbiddenToolNames.length > 0) {
    lines.push(`- **PROIBIDO** neste turno: ${decision.forbiddenToolNames.slice(0, 12).join(", ")}.`);
  }
  if (!decision.mandatoryNextTool && decision.pendingRequired.length === 0) {
    lines.push("- Plano de tools concluído — pode responder ao utilizador.");
  }
  return `${lines.join("\n")}\n`;
}
