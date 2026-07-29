import { buildCapabilityGraph } from "./CapabilityGraph.js";
import { factValuesMap, factsFromFlowSlots, hasFact, mergeFactStores } from "./FactsEngine.js";
import { isEilEnabled, parseEilBehaviorConfig } from "./parseEilConfig.js";
import { resolveForbiddenActions } from "./PolicyEngine.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
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
import { evaluatePolicies } from "./PolicyEngine.js";

export type BuildExecutionIntelligencePlanOpts = BuildEilContextOpts & {
  facts?: FactStore;
  graph?: CapabilityGraph;
  toolsCalled?: string[];
};

/**
 * Plano de execução EIL — reutiliza ExecutionTurnPlan legado e acrescenta facts/policies.
 */
export function buildExecutionIntelligencePlan(
  opts: BuildExecutionIntelligencePlanOpts,
): ExecutionIntelligencePlan {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames,
  });

  const eilEnabled = isEilEnabled(opts.behaviorConfig);
  const eilCfg = parseEilBehaviorConfig(opts.behaviorConfig);
  const graph =
    opts.graph ??
    buildCapabilityGraph({
      tools: opts.toolConfigs ?? (opts.availableToolNames ?? []).map((name) => ({ name })),
    });

  const facts =
    opts.facts ??
    mergeFactStores(opts.priorFacts ?? {}, factsFromFlowSlots(opts.flowSlots));

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
    const called = (opts.toolsCalled ?? []).some((t) => t.toLowerCase() === toolName.toLowerCase());
    if (!called) pendingTools.push(toolName);
  }

  // Producers of unmet required facts — schedule before dependents (Tool Call Accuracy).
  for (const fact of pendingFacts) {
    for (const producer of graph.producersByFact[fact] ?? []) {
      const alreadyPending = pendingTools.some((t) => t.toLowerCase() === producer.toLowerCase());
      const alreadyCalled = (opts.toolsCalled ?? []).some(
        (t) => t.toLowerCase() === producer.toLowerCase(),
      );
      const inAvailable =
        !opts.availableToolNames?.length ||
        opts.availableToolNames.some((t) => t.toLowerCase() === producer.toLowerCase());
      if (!alreadyPending && !alreadyCalled && inAvailable) {
        pendingTools.unshift(producer);
      }
    }
  }

  // Pending capabilities: capabilities of pending tools
  const pendingCapabilities = new Set<string>();
  for (const toolName of pendingTools) {
    const node = graph.nodes.find((n) => n.toolName.toLowerCase() === toolName.toLowerCase());
    for (const c of node?.capabilities ?? []) pendingCapabilities.add(c);
  }

  const policies = eilCfg?.policies ?? [];
  const forbiddenActions = eilEnabled ? resolveForbiddenActions(policies, facts) : [];
  const policyIds = policies.map((p) => p.id);

  return {
    ...turnPlan,
    requiredFacts: [...requiredFacts],
    knownFactKeys,
    pendingFacts,
    pendingTools,
    pendingCapabilities: [...pendingCapabilities],
    forbiddenActions,
    policyIds,
    eilEnabled,
  };
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
