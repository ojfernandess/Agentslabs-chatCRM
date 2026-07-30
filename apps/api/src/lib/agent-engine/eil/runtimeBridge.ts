import {
  buildCapabilityGraph,
  buildEilSnapshot,
  buildExecutionIntelligencePlan,
  factsFromFlowSlots,
  factsToFlowSlots,
  ingestToolOutcomes,
  mergeFactStores,
  type CapabilityGraph,
  type EilSnapshot,
  type ExecutionIntelligencePlan,
  type FactStore,
  type ToolOutcomeForEil,
} from "./index.js";
import { priorToolOutcomesFromSession } from "../core/sessionToolOutcomes.js";
import { readLastAssistantPreview } from "../core/confirmationTurnGuards.js";

/** Extrai flowSlots do snapshot de memória do runtime. */
export function flowSlotsFromMemory(memory: Record<string, unknown> | undefined): Record<
  string,
  string | number | boolean
> {
  if (!memory) return {};
  const slots = memory.flowSlots;
  if (slots && typeof slots === "object" && !Array.isArray(slots)) {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(slots as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    }
    return out;
  }
  return {};
}

export type ResolveEilTurnOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  memory?: Record<string, unknown>;
  toolOutcomes?: ToolOutcomeForEil[];
  replyText?: string;
  toolConfigs?: Array<{ name: string; config?: unknown }>;
  availableToolNames?: string[];
  priorFacts?: FactStore;
  /** Congela promoção a conclusão (exclusive gate no begin). */
  freezeCompletionPromotion?: boolean;
  /** Turno sintético pós-conclusão (Passo 8). */
  postCompletionFollowUp?: boolean;
};

export type ResolveEilTurnResult = {
  enabled: boolean;
  graph: CapabilityGraph;
  facts: FactStore;
  plan: ExecutionIntelligencePlan;
  snapshot: EilSnapshot;
  flowSlotsPatch: Record<string, string | number | boolean>;
};

/**
 * Resolve plano + facts + snapshot EIL para um turno (usado por LangGraph / orchestration).
 * Sem EIL no behaviorConfig → enabled=false e checks no-op.
 */
export function resolveEilTurn(opts: ResolveEilTurnOpts): ResolveEilTurnResult {
  const flowSlots = flowSlotsFromMemory(opts.memory);
  const tools =
    opts.toolConfigs ??
    [
      ...(opts.availableToolNames ?? []).map((name) => ({ name })),
      ...(opts.toolOutcomes ?? []).map((o) => ({ name: o.name })),
    ].filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i);

  const graph = buildCapabilityGraph({ tools });
  const prior = mergeFactStores(
    opts.priorFacts ?? {},
    factsFromFlowSlots(flowSlots),
  );
  const facts = ingestToolOutcomes({
    outcomes: opts.toolOutcomes ?? [],
    prior,
    graph,
  });
  const toolsCalled = (opts.toolOutcomes ?? []).filter((t) => t.ok).map((t) => t.name);
  const sessionPrior = priorToolOutcomesFromSession(flowSlots);
  const lastAssistantMessage = readLastAssistantPreview(opts.memory ?? flowSlots);
  const plan = buildExecutionIntelligencePlan({
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames ?? tools.map((t) => t.name),
    toolConfigs: tools,
    facts,
    graph,
    toolsCalled,
    flowSlots,
    priorToolOutcomes: sessionPrior,
    sessionPriorOutcomes: sessionPrior,
    lastAssistantMessage,
    memory: opts.memory,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    postCompletionFollowUp: opts.postCompletionFollowUp,
  });
  const snapshot = buildEilSnapshot({
    behaviorConfig: opts.behaviorConfig,
    plan,
    facts,
    graph,
    toolsCalled,
    replyText: opts.replyText,
    outcomes: opts.toolOutcomes,
  });

  return {
    enabled: plan.eilEnabled,
    graph,
    facts,
    plan,
    snapshot,
    flowSlotsPatch: factsToFlowSlots(facts),
  };
}
