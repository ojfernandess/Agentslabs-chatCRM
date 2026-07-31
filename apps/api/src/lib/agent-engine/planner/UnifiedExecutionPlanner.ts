/**
 * Fase 3 — Planner unificado: Prompt IR → TurnPlan → EIL → PlanGraph.
 * Uma única resolução de turnPolicy/required tools por turno.
 */
import type { PromptIR } from "../contract/PromptIR.js";
import { compilePromptToIR, type CompilePromptToIROpts } from "../compiler/compilePromptToIR.js";
import { playbookTextFromBehavior } from "../compiler/playbookText.js";
import { buildCapabilityGraph } from "../eil/CapabilityGraph.js";
import { factsFromFlowSlots, hasFact, mergeFactStores } from "../eil/FactsEngine.js";
import { isEilEnabled, parseEilBehaviorConfig } from "../eil/parseEilConfig.js";
import {
  evaluatePromptIrPolicyRules,
  resolveForbiddenActions,
} from "../eil/PolicyEngine.js";
import type {
  CapabilityGraph,
  ExecutionIntelligencePlan,
  FactStore,
} from "../eil/types.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import { shouldRequireCallHumanThisTurn } from "../escalation/escalationTurnDetection.js";
import { unitKbTurnNeedsEstablishmentCollection } from "../../unitKnowledgeFlow.js";
import { isPostCompletionPending } from "../core/sessionToolOutcomes.js";
import { guestAsksQuoteCategoryInfo } from "../core/confirmationTurnGuards.js";
import {
  GENERIC_TURN_PATTERNS,
} from "../validators/requiredToolNamesParser.js";
import type { ExecutionTurnPlan } from "./ExecutionTurnPlan.js";
import { buildPlanGraph, type PlanGraph } from "./PlanGraphBuilder.js";

export type UnifiedExecutionPlan = ExecutionIntelligencePlan & {
  planGraph: PlanGraph;
  promptIrHash: string;
};

export type BuildUnifiedExecutionPlanOpts = CompilePromptToIROpts & {
  /** Quando omitido, compila Prompt IR internamente (legacy callers). */
  promptIr?: PromptIR;
  facts?: FactStore;
  graph?: CapabilityGraph;
  toolsCalled?: string[];
  priorFacts?: FactStore;
};

function compileOptsFromBuild(opts: BuildUnifiedExecutionPlanOpts): CompilePromptToIROpts {
  const memoryFlowSlots = opts.flowSlots ?? (opts.memory?.flowSlots as Record<string, string | number | boolean> | undefined);
  return {
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames,
    priorToolOutcomes: opts.priorToolOutcomes,
    sessionPriorOutcomes: opts.sessionPriorOutcomes,
    flowSlots: memoryFlowSlots,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    lastAssistantMessage: opts.lastAssistantMessage,
    memory: opts.memory,
    postCompletionFollowUp: opts.postCompletionFollowUp,
    workflowPlannedToolNames: opts.workflowPlannedToolNames,
  };
}

/** Padrões activos via IR turnPatterns + GENERIC_TURN_PATTERNS (sem regex de tool names). */
export function inferMatchedPatternIds(
  userMessage: string,
  promptIr: PromptIR,
  behaviorConfig?: Record<string, unknown> | null | undefined,
): string[] {
  const msg = (userMessage ?? "").trim();
  const playbook = playbookTextFromBehavior(behaviorConfig);
  const registryIds = new Set(promptIr.turnPatterns.map((t) => t.registryId));
  const matched: string[] = [];
  for (const pattern of GENERIC_TURN_PATTERNS) {
    if (!registryIds.has(pattern.id)) continue;
    if (!pattern.playbookHints.test(playbook)) continue;
    if (!pattern.test(msg)) continue;
    matched.push(pattern.id);
  }
  if (matched.length === 0 && /^\d{11}$/.test(msg)) {
    matched.push("document_id");
  }
  return matched;
}

export function executionTurnPlanFromPromptIr(
  promptIr: PromptIR,
  opts: BuildUnifiedExecutionPlanOpts,
): ExecutionTurnPlan {
  const userMessage = (opts.userMessage ?? "").trim();
  const flowSlots =
    opts.flowSlots ?? (opts.memory?.flowSlots as Record<string, string | number | boolean> | undefined);
  const matchedPatternIds = inferMatchedPatternIds(userMessage, promptIr, opts.behaviorConfig);
  const quoteFlow = matchedPatternIds.some((id) =>
    ["quote_request", "quote_stay_details", "availability_quote"].includes(id),
  );
  const quoteCategoryInfoTurn = guestAsksQuoteCategoryInfo({
    userMessage,
    lastAssistantMessage: opts.lastAssistantMessage,
    flowSlots,
  });
  const knowledgeSeeking =
    !unitKbTurnNeedsEstablishmentCollection({
      userMessage,
      lastAssistantMessage: opts.lastAssistantMessage,
      flowSlots,
    }) &&
    !shouldRequireCallHumanThisTurn({
      userMessage,
      lastAssistantMessage: opts.lastAssistantMessage,
    }) &&
    !matchedPatternIds.includes("escalation") &&
    (quoteCategoryInfoTurn ||
      (!quoteFlow &&
        (userMessageLooksLikeKnowledgeSeekingQuery(userMessage) ||
          opts.postCompletionFollowUp === true ||
          isPostCompletionPending(flowSlots))));

  return {
    userMessage,
    requiredToolNames: [...promptIr.tools.required],
    turnPolicy: promptIr.turnPolicy,
    knowledgeSeeking,
    matchedPatternIds,
  };
}

/**
 * Planner unificado — substitui buildExecutionTurnPlan + buildExecutionIntelligencePlan duplicados.
 */
export function buildUnifiedExecutionPlan(
  opts: BuildUnifiedExecutionPlanOpts,
): UnifiedExecutionPlan {
  const promptIr = opts.promptIr ?? compilePromptToIR(compileOptsFromBuild(opts));
  const turnPlan = executionTurnPlanFromPromptIr(promptIr, opts);

  const eilEnabled = isEilEnabled(opts.behaviorConfig);
  const eilCfg = parseEilBehaviorConfig(opts.behaviorConfig);
  const memoryFlowSlots =
    opts.flowSlots ?? (opts.memory?.flowSlots as Record<string, string | number | boolean> | undefined);

  const graph =
    opts.graph ??
    buildCapabilityGraph({
      tools: (opts.availableToolNames ?? []).map((name) => ({ name })),
    });

  const facts =
    opts.facts ??
    mergeFactStores(opts.priorFacts ?? {}, factsFromFlowSlots(memoryFlowSlots ?? undefined));

  const toolsCalled = opts.toolsCalled ?? [];

  evaluatePromptIrPolicyRules({
    rules: promptIr.policies,
    facts,
    toolsCalledThisTurn: toolsCalled,
    turnPolicy: promptIr.turnPolicy,
  });

  const requiredFacts = new Set<string>();
  for (const toolName of turnPlan.requiredToolNames) {
    const node = graph.nodes.find((n) => n.toolName.toLowerCase() === toolName.toLowerCase());
    if (!node) continue;
    for (const f of node.requiresFacts) requiredFacts.add(f);
  }
  const knownFactKeys = Object.keys(facts).filter((k) => hasFact(facts, k));
  const pendingFacts = [...requiredFacts].filter((f) => !hasFact(facts, f));

  const pendingTools: string[] = [];
  for (const toolName of turnPlan.requiredToolNames) {
    const called = toolsCalled.some((t) => t.toLowerCase() === toolName.toLowerCase());
    if (!called) pendingTools.push(toolName);
  }

  for (const fact of pendingFacts) {
    for (const producer of graph.producersByFact[fact] ?? []) {
      const alreadyPending = pendingTools.some((t) => t.toLowerCase() === producer.toLowerCase());
      const alreadyCalled = toolsCalled.some((t) => t.toLowerCase() === producer.toLowerCase());
      const inAvailable =
        !opts.availableToolNames?.length ||
        opts.availableToolNames.some((t) => t.toLowerCase() === producer.toLowerCase());
      if (!alreadyPending && !alreadyCalled && inAvailable) {
        pendingTools.unshift(producer);
      }
    }
  }

  const pendingCapabilities = new Set<string>();
  for (const toolName of pendingTools) {
    const node = graph.nodes.find((n) => n.toolName.toLowerCase() === toolName.toLowerCase());
    for (const c of node?.capabilities ?? []) pendingCapabilities.add(c);
  }

  const eilPolicies = eilCfg?.policies ?? [];
  const forbiddenActions = eilEnabled ? resolveForbiddenActions(eilPolicies, facts) : [];
  const policyIds = [
    ...promptIr.policies.map((p) => p.id),
    ...eilPolicies.map((p) => p.id),
  ];

  const planGraph = buildPlanGraph({
    flows: promptIr.flows,
    requiredToolNames: turnPlan.requiredToolNames,
    graph,
    facts,
    toolsCalled,
  });

  if (planGraph.orderedToolNames.length > 0) {
    for (const t of planGraph.orderedToolNames) {
      if (!pendingTools.some((p) => p.toLowerCase() === t.toLowerCase())) {
        if (turnPlan.requiredToolNames.some((r) => r.toLowerCase() === t.toLowerCase())) {
          pendingTools.unshift(t);
        }
      }
    }
  }

  return {
    ...turnPlan,
    requiredFacts: [...requiredFacts],
    knownFactKeys,
    pendingFacts,
    pendingTools: [...new Set(pendingTools)],
    pendingCapabilities: [...pendingCapabilities],
    forbiddenActions,
    policyIds: [...new Set(policyIds)],
    eilEnabled,
    planGraph,
    promptIrHash: promptIr.metadata.hash,
  };
}
