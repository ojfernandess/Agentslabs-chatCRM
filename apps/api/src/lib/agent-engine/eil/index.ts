export type {
  Fact,
  FactValue,
  FactStore,
  ToolEilConfig,
  CapabilityNode,
  CapabilityGraph,
  FactPredicateOp,
  FactPredicate,
  EilPolicy,
  EilBehaviorConfig,
  ConstraintViolation,
  ReplyActionId,
  ExecutionIntelligencePlan,
  EilSnapshot,
  ToolOutcomeForEil,
  BuildEilContextOpts,
} from "./types.js";

export { parseEilBehaviorConfig, isEilEnabled, parseToolEilConfig } from "./parseEilConfig.js";
export { buildCapabilityGraph, findCapabilityNode } from "./CapabilityGraph.js";
export {
  toolRequiresUnmetFacts,
  canInvokeTool,
  orderToolsByFactDeps,
  capabilityPreExecBlockReason,
  detectToolOrderViolations,
} from "./CapabilityGraph.js";
export {
  getPathValue,
  extractFactsFromToolResult,
  factsFromFlowSlots,
  mergeFactStores,
  ingestToolOutcomes,
  factsToFlowSlots,
  factValuesMap,
  hasFact,
} from "./FactsEngine.js";
export { detectReplyActions } from "./detectReplyActions.js";
export { evaluatePredicate, evaluatePolicies, resolveForbiddenActions, evaluatePromptIrPolicyRules } from "./PolicyEngine.js";
export {
  buildExecutionIntelligencePlan,
  buildEilSnapshot,
} from "./ExecutionPlanner.js";
export {
  flowSlotsFromMemory,
  resolveEilTurn,
  type ResolveEilTurnOpts,
  type ResolveEilTurnResult,
} from "./runtimeBridge.js";
