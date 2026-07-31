import { priorToolOutcomesFromSession } from "./sessionToolOutcomes.js";
import { readLastAssistantPreview } from "./confirmationTurnGuards.js";
import { compilePromptToIR } from "../compiler/PromptCompiler.js";
import { promptIrToContract } from "../contract/promptIrAdapter.js";
import { analyzeTurnIntent } from "../compiler/IntentAnalyzer.js";
import type { ResolveEilTurnResult } from "../eil/runtimeBridge.js";
import type { ToolOutcomeForEil } from "../eil/types.js";
import { buildUnifiedExecutionPlan } from "../planner/UnifiedExecutionPlanner.js";
import type { FactStore } from "../eil/types.js";
import { buildCapabilityGraph } from "../eil/CapabilityGraph.js";
import { factsFromFlowSlots, ingestToolOutcomes, mergeFactStores } from "../eil/FactsEngine.js";
import { buildEilSnapshot } from "../eil/ExecutionPlanner.js";
import { factsToFlowSlots } from "../eil/FactsEngine.js";
import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import type {
  ExecutionContract,
  IntentAnalysis,
  PromptContract,
  TurnContext,
} from "./types.js";

export function analyzeIntent(userMessage: string, turnPlan: ExecutionTurnPlan): IntentAnalysis {
  return analyzeTurnIntent(userMessage, turnPlan);
}

export function buildExecutionContract(opts: {
  turnId: string;
  userMessage: string;
  promptContract: PromptContract;
  toolOutcomes?: ToolOutcomeForEil[];
  eil?: ResolveEilTurnResult;
}): ExecutionContract {
  const outcomes = opts.toolOutcomes ?? [];
  const required = opts.promptContract.requiredToolNames;
  const satisfied = required.filter((n) => toolOutcomeSatisfiesRequired(n, outcomes));
  const pending = required.filter((n) => !toolOutcomeSatisfiesRequired(n, outcomes));
  const violations: string[] = [];

  for (const p of pending) {
    violations.push(`required_tool_missing:${p}`);
  }

  const forbiddenHit = opts.promptContract.forbiddenToolNames.filter((f) =>
    outcomes.some((t) => t.ok !== false && t.name.toLowerCase().includes(f.toLowerCase())),
  );
  for (const f of forbiddenHit) {
    violations.push(`forbidden_tool_used:${f}`);
  }

  const eilViolations = opts.eil?.snapshot.violations ?? [];
  const requiredFacts = opts.eil?.plan.pendingFacts ?? [];
  const existingFacts = Object.keys(opts.eil?.facts ?? {}).filter(
    (k) => opts.eil!.facts[k]?.value != null,
  );

  for (const fact of requiredFacts) {
    violations.push(`fact_missing:${fact}`);
  }

  let planPhase: ExecutionContract["planPhase"] = "planning";
  if (pending.length === 0 && required.length > 0 && requiredFacts.length === 0) {
    planPhase = "reply";
  } else if (pending.length > 0 || requiredFacts.length > 0) {
    planPhase = "tooling";
  } else if (required.length === 0) {
    planPhase = "reply";
  }

  return {
    version: 1,
    turnId: opts.turnId,
    userMessage: opts.userMessage,
    objective: opts.promptContract.objective,
    planPhase,
    requiredToolNames: required,
    forbiddenToolNames: opts.promptContract.forbiddenToolNames,
    pendingToolNames: pending,
    satisfiedToolNames: satisfied,
    requiredFacts,
    existingFacts,
    constraints: eilViolations.map((v) => v.reason),
    completionCriteria: [
      pending.length === 0 && requiredFacts.length === 0
        ? "required_tools_satisfied"
        : `pending_tools:${pending.join(",")}|pending_facts:${requiredFacts.join(",")}`,
    ],
    valid: violations.length === 0 && eilViolations.length === 0,
    violations,
  };
}

export type BuildTurnContextOpts = {
  turnId: string;
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
  toolOutcomes?: ToolOutcomeForEil[];
  toolConfigs?: Array<{ name: string; config?: unknown }>;
  memory?: Record<string, unknown>;
  priorFacts?: FactStore;
  eilResolve?: ResolveEilTurnResult;
  /** Snapshot de tools da sessão no beginTurn (antes do schedule). */
  sessionPriorOutcomes?: Array<{ name: string; ok?: boolean }>;
  /** Turno iniciou com exclusive gate — congela promoção a conclusão. */
  freezeCompletionPromotion?: boolean;
  /** Turno sintético pós-conclusão (Passo 8). */
  postCompletionFollowUp?: boolean;
  /** Tools planeadas pelo Workflow (explícito ou implícito). */
  workflowPlannedToolNames?: string[];
  /**
   * Preview do assistente congelado no beginTurn.
   * Se omitido, lê de memory — mas refresh mid-turn NÃO deve re-ler a reply actual.
   */
  lastAssistantMessage?: string | null;
};

/** Constrói TurnContext completo — ponto de entrada único por turno (Fase 1). */
export function buildTurnContext(opts: BuildTurnContextOpts): TurnContext {
  const userMessage = (opts.userMessage ?? "").trim();
  const memoryFlowSlots = opts.memory?.flowSlots as
    | Record<string, string | number | boolean>
    | undefined;
  const priorToolOutcomes = priorToolOutcomesFromSession(memoryFlowSlots);
  const sessionPriorOutcomes = opts.sessionPriorOutcomes ?? priorToolOutcomes;
  const lastAssistantMessage =
    opts.lastAssistantMessage !== undefined && opts.lastAssistantMessage !== null
      ? opts.lastAssistantMessage
      : readLastAssistantPreview(opts.memory ?? memoryFlowSlots ?? null);
  const compileOpts = {
    behaviorConfig: opts.behaviorConfig,
    userMessage,
    availableToolNames: opts.availableToolNames,
    priorToolOutcomes,
    sessionPriorOutcomes,
    flowSlots: memoryFlowSlots,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    lastAssistantMessage,
    memory: opts.memory,
    postCompletionFollowUp: opts.postCompletionFollowUp,
    workflowPlannedToolNames: opts.workflowPlannedToolNames,
  };
  const promptIr = compilePromptToIR(compileOpts);
  const promptContract = promptIrToContract(promptIr);

  const tools =
    opts.toolConfigs ??
    [
      ...(opts.availableToolNames ?? []).map((name) => ({ name })),
      ...(opts.toolOutcomes ?? []).map((o) => ({ name: o.name })),
    ].filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i);
  const graph = buildCapabilityGraph({ tools });
  const prior = mergeFactStores(
    opts.priorFacts ?? {},
    factsFromFlowSlots(memoryFlowSlots),
  );
  const facts = ingestToolOutcomes({
    outcomes: opts.toolOutcomes ?? [],
    prior,
    graph,
  });
  const toolsCalled = (opts.toolOutcomes ?? []).filter((t) => t.ok).map((t) => t.name);

  const unifiedPlan = buildUnifiedExecutionPlan({
    ...compileOpts,
    behaviorConfig: opts.behaviorConfig,
    promptIr,
    facts,
    graph,
    toolsCalled,
    priorFacts: opts.priorFacts,
  });

  const turnPlan: ExecutionTurnPlan = unifiedPlan;
  const intent = analyzeIntent(userMessage, turnPlan);

  const eil: ResolveEilTurnResult =
    opts.eilResolve ?? {
      enabled: unifiedPlan.eilEnabled,
      graph,
      facts,
      plan: unifiedPlan,
      snapshot: buildEilSnapshot({
        behaviorConfig: opts.behaviorConfig,
        plan: unifiedPlan,
        facts,
        graph,
        toolsCalled,
        outcomes: opts.toolOutcomes,
      }),
      flowSlotsPatch: factsToFlowSlots(facts),
    };

  const executionContract = buildExecutionContract({
    turnId: opts.turnId,
    userMessage,
    promptContract,
    toolOutcomes: opts.toolOutcomes,
    eil,
  });

  return {
    version: 1,
    userMessage,
    intent,
    promptIr,
    promptContract,
    turnPlan,
    executionContract,
    eilEnabled: eil.enabled,
    eilPlan: eil.plan,
    facts: eil.facts,
    capabilityGraph: eil.graph,
    eilSnapshot: eil.snapshot,
    availableToolNames: opts.availableToolNames ?? [],
  };
}
