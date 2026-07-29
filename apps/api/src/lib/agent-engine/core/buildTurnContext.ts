import { priorToolOutcomesFromSession } from "./sessionToolOutcomes.js";
import { readLastAssistantPreview } from "./confirmationTurnGuards.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import { compilePromptContract } from "../compiler/PromptCompiler.js";
import type { ToolOutcomeForEil } from "../eil/types.js";
import { resolveEilTurn, type ResolveEilTurnResult } from "../eil/runtimeBridge.js";
import type { FactStore } from "../eil/types.js";
import { buildExecutionTurnPlan, type ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import type {
  ExecutionContract,
  IntentAnalysis,
  IntentKind,
  PromptContract,
  TurnContext,
} from "./types.js";

export function analyzeIntent(userMessage: string, turnPlan: ExecutionTurnPlan): IntentAnalysis {
  const msg = (userMessage ?? "").trim();
  let kind: IntentKind = "general";
  let confidence = 0.55;

  if (turnPlan.matchedPatternIds.includes("structured_form_submission")) {
    kind = "data_submission";
    confidence = 0.88;
  } else if (turnPlan.knowledgeSeeking || userMessageLooksLikeKnowledgeSeekingQuery(msg)) {
    kind = "knowledge_query";
    confidence = 0.85;
  } else if (/^(sim|ok|confirmo|yes|não|nao|no)$/i.test(msg)) {
    kind = "confirmation";
    confidence = 0.9;
  } else if (/^\d{11}$/.test(msg) || /^[A-Z0-9]{6,12}$/i.test(msg)) {
    kind = "data_submission";
    confidence = 0.8;
  } else if (turnPlan.matchedPatternIds.includes("escalation")) {
    kind = "escalation_request";
    confidence = 0.75;
  } else if (turnPlan.requiredToolNames.length > 0) {
    kind = "operational_action";
    confidence = 0.7;
  }

  const entities: Record<string, string> = {};
  const doc = msg.match(/\b\d{11}\b/);
  if (doc) entities.documentNumber = doc[0];
  // Localizador: 6–12 alfanuméricos com pelo menos 1 dígito (evita apanhar palavras como "reserva").
  const loc = msg.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i);
  if (loc) entities.referenceCode = loc[0].toUpperCase();

  return {
    kind,
    confidence,
    entities,
    expectedGoal: kind === "knowledge_query" ? "answer_from_knowledge" : "complete_operational_flow",
  };
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
};

/** Constrói TurnContext completo — ponto de entrada único por turno (Fase 1). */
export function buildTurnContext(opts: BuildTurnContextOpts): TurnContext {
  const userMessage = (opts.userMessage ?? "").trim();
  const memoryFlowSlots = opts.memory?.flowSlots as
    | Record<string, string | number | boolean>
    | undefined;
  const priorToolOutcomes = priorToolOutcomesFromSession(memoryFlowSlots);
  const sessionPriorOutcomes = opts.sessionPriorOutcomes ?? priorToolOutcomes;
  const lastAssistantMessage = readLastAssistantPreview(opts.memory ?? memoryFlowSlots ?? null);
  const promptContract = compilePromptContract({
    behaviorConfig: opts.behaviorConfig,
    userMessage,
    availableToolNames: opts.availableToolNames,
    priorToolOutcomes,
    sessionPriorOutcomes,
    flowSlots: memoryFlowSlots,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    lastAssistantMessage,
    memory: opts.memory,
  });
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: opts.behaviorConfig,
    userMessage,
    availableToolNames: opts.availableToolNames,
    priorToolOutcomes,
    sessionPriorOutcomes,
    flowSlots: memoryFlowSlots,
    freezeCompletionPromotion: opts.freezeCompletionPromotion,
    lastAssistantMessage,
    memory: opts.memory,
  });
  const intent = analyzeIntent(userMessage, turnPlan);

  const eil =
    opts.eilResolve ??
    resolveEilTurn({
      behaviorConfig: opts.behaviorConfig,
      userMessage,
      memory: opts.memory,
      toolOutcomes: opts.toolOutcomes,
      toolConfigs: opts.toolConfigs,
      availableToolNames: opts.availableToolNames,
      priorFacts: opts.priorFacts,
    });

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
