import { buildCapabilityGraph } from "./CapabilityGraph.js";
import { factValuesMap } from "./FactsEngine.js";
import { parseEilBehaviorConfig } from "./parseEilConfig.js";
import { evaluatePolicies } from "./PolicyEngine.js";
import { buildUnifiedExecutionPlan } from "../planner/UnifiedExecutionPlanner.js";
import type {
  BuildEilContextOpts,
  CapabilityGraph,
  EilSnapshot,
  ExecutionIntelligencePlan,
  FactStore,
  ToolOutcomeForEil,
} from "./types.js";
import { ingestToolOutcomes } from "./FactsEngine.js";
import { detectReplyActions } from "./detectReplyActions.js";

export type BuildExecutionIntelligencePlanOpts = BuildEilContextOpts & {
  facts?: FactStore;
  graph?: CapabilityGraph;
  toolsCalled?: string[];
};

/**
 * Plano EIL — delega ao UnifiedExecutionPlanner (Fase 3).
 */
export function buildExecutionIntelligencePlan(
  opts: BuildExecutionIntelligencePlanOpts,
): ExecutionIntelligencePlan {
  const unified = buildUnifiedExecutionPlan({
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames,
    priorToolOutcomes: opts.priorToolOutcomes,
    sessionPriorOutcomes: opts.sessionPriorOutcomes ?? opts.priorToolOutcomes,
    flowSlots: opts.flowSlots,
    lastAssistantMessage: opts.lastAssistantMessage,
    memory: opts.memory,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    postCompletionFollowUp: opts.postCompletionFollowUp,
    workflowPlannedToolNames: opts.workflowPlannedToolNames,
    facts: opts.facts,
    graph: opts.graph,
    toolsCalled: opts.toolsCalled,
    priorFacts: opts.priorFacts,
  });
  return unified;
}

export type BuildEilSnapshotOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  plan: ExecutionIntelligencePlan;
  facts: FactStore;
  graph: CapabilityGraph;
  toolsCalled: string[];
  replyText?: string;
  outcomes?: ToolOutcomeForEil[];
};

/** Snapshot completo para trace / Supervisor / MCP. */
export function buildEilSnapshot(opts: BuildEilSnapshotOpts): EilSnapshot {
  const eilCfg = parseEilBehaviorConfig(opts.behaviorConfig);
  const enabled = opts.plan.eilEnabled;
  const replyActions = detectReplyActions(opts.replyText ?? "");
  const policies = eilCfg?.policies ?? [];
  const violations =
    enabled && opts.replyText
      ? evaluatePolicies({
          policies,
          facts: opts.facts,
          replyActions,
        })
      : [];

  const capabilitiesUsed = new Set<string>();
  for (const name of opts.toolsCalled) {
    const node = opts.graph.nodes.find((n) => n.toolName.toLowerCase() === name.toLowerCase());
    for (const c of node?.capabilities ?? []) capabilitiesUsed.add(c);
  }

  return {
    enabled,
    plan: opts.plan,
    facts: factValuesMap(opts.facts),
    factDetails: opts.facts,
    capabilitiesUsed: [...capabilitiesUsed],
    policiesApplied: policies.map((p) => p.id),
    violations,
    toolsCalled: opts.toolsCalled,
    toolsPending: opts.plan.pendingTools,
    replyActions,
  };
}

export { ingestToolOutcomes, buildCapabilityGraph };
