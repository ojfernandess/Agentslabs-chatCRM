export * from "./types.js";
export { parseAgentEngineConfig, mergeAgentEngineIntoBehavior } from "./config/parseAgentEngineConfig.js";
export type { AgentRuntime } from "./runtime/AgentRuntime.js";
export { AgentRuntimeFactory } from "./runtime/AgentRuntimeFactory.js";
export { OpenNexoRuntime, type NativeAgentExecutor } from "./runtime/OpenNexoRuntime.js";
export {
  runWorkflowRuntimeTurn,
  resolveEffectiveToolExecutionMode,
} from "./runtime/WorkflowRuntimeOrchestrator.js";
export { LangGraphRuntime } from "./runtime/LangGraphRuntime.js";
export { CrewAIRuntime } from "./runtime/CrewAIRuntime.js";
export { AutoGenRuntime } from "./runtime/AutoGenRuntime.js";
export { MastraRuntime } from "./runtime/MastraRuntime.js";
export { validateToolExecution, unresolvedToolFailures } from "./validators/ToolValidator.js";
export { validateAgentPrompt } from "./validators/PromptValidator.js";
export { auditPromptAssembly } from "./audit/promptAssemblyAudit.js";
export {
  validateAgentWorkflow,
  shouldBlockOutboundFromWorkflow,
  type WorkflowAuditReport,
  type WorkflowAuditFinding,
  type WorkflowAuditMetrics,
} from "./audit/WorkflowValidator.js";
export {
  runWorkflowGate,
  shouldRunWorkflowGate,
  resolveRequiredToolNamesForValidation,
  type WorkflowGateInput,
  type WorkflowGateResult,
} from "./audit/applyWorkflowGate.js";
export {
  buildExecutionTurnPlan,
  type ExecutionTurnPlan,
} from "./planner/ExecutionTurnPlan.js";
export * from "./eil/index.js";
export {
  parseRequiredToolNamesFromText,
  resolveRequiredToolNamesFromBehavior,
  resolveRequiredToolNamesForTurn,
  toolOutcomeSatisfiesRequired,
  parseCategoryToolMapFromPlaybook,
  GENERIC_TURN_PATTERNS,
} from "./validators/requiredToolNamesParser.js";
export {
  resolveTurnPolicy,
  parseForbiddenSameTurnPairsFromPlaybook,
  validateToolOutcomesAgainstTurnPolicy,
  shouldUseReplyOnlyRetry,
  isLikelyMutableOrCompletionTool,
  toolAliasesToOmitFromCatalog,
  toolNameMatchesOmitAlias,
  buildPostGateSafeFallbackReply,
  confirmationGateSatisfiedThisTurn,
  buildCompletionSafeFallbackReply,
  completionToolSatisfiedThisTurn,
  type TurnPolicy,
  type ForbiddenToolPair,
} from "./validators/turnPolicyParser.js";
export {
  computeReplyConfidence,
  evaluateStrictModeGate,
  STRICT_MODE_MIN_CONFIDENCE,
} from "./validators/StrictModeGate.js";
export {
  createMemoryProvider,
  OpenNexoMemoryProvider,
  Mem0MemoryProvider,
  MemoryEngineService,
  buildMemoryLoadedObservability,
} from "./memory/MemoryProvider.js";
export { logMemoryEvents } from "./memory/MemoryObservability.js";
export {
  parseMemoryEngineConfig,
  mergeMemoryEngineIntoBehavior,
  parseOrgMemoryStore,
} from "./memory/parseMemoryEngineConfig.js";
export type {
  MemoryEngineConfig,
  MemoryEngineOrgConfig,
  MemoryRecord,
  MemoryCategory,
} from "./memory/memoryEngineTypes.js";
export { DEFAULT_MEMORY_ENGINE_CONFIG } from "./memory/memoryEngineTypes.js";
export {
  buildMem0AgentId,
  buildMem0UserId,
  isMem0Configured,
  readMem0Config,
} from "./memory/mem0Client.js";
export { formatMem0PromptAppendix, syncTurnToMem0, loadMem0MemoriesForPrompt } from "./memory/mem0MemoryBridge.js";
export {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldRetryAfterSupervisor,
  shouldBlockReplyAfterSupervisor,
} from "./supervisor/AgentSupervisorService.js";
export {
  createAgentGraphCheckpointer,
  getAgentGraphCheckpointer,
  readGraphCheckpointSnapshot,
  isRedisStackCheckpointAvailable,
  resolveAgentCheckpointMode,
} from "./checkpoint/AgentCheckpointFactory.js";
export type { GraphCheckpointSnapshot, AgentCheckpointMode } from "./checkpoint/AgentCheckpointFactory.js";
export {
  initRedisLangGraphCheckpointer,
  closeRedisLangGraphCheckpointer,
  probeRedisJsonModuleSupport,
} from "./checkpoint/RedisLangGraphCheckpointer.js";
export {
  ingestAgentTraceToLangfuse,
  isLangfuseConfigured,
  readLangfuseConfig,
  resolveRuntimeLayer,
  buildLayerSpans,
} from "./observability/LangfuseBridge.js";
export type { RuntimeLayerId } from "./observability/LangfuseBridge.js";
export {
  registerHitlPending,
  getHitlPending,
  getHitlPendingAsync,
  listHitlPending,
  listHitlPendingAsync,
  resolveHitlPending,
  type HitlPendingApproval,
} from "./hitl/HumanInTheLoopStore.js";
export { resolveHitlWithActions } from "./hitl/HitlDeliveryService.js";
export { publishGraphEvent, subscribeGraphEvents } from "./observability/AgentGraphEventBus.js";
export {
  ensureAgentEngineRedisReady,
  isAgentEngineRedisAvailable,
} from "./redis/agentEngineRedis.js";
export {
  persistGraphCheckpointSnapshot,
  readGraphCheckpointSnapshotWithFallback,
} from "./checkpoint/AgentCheckpointFactory.js";
export { ExecutionTraceBuilder } from "./observability/ExecutionTrace.js";
export {
  createKnowledgeProvider,
  KnowledgeEngineService,
  type KnowledgeProvider,
} from "./knowledge/KnowledgeProvider.js";
export { logKnowledgeEvents } from "./knowledge/KnowledgeObservability.js";
export {
  parseKnowledgeEngineConfig,
  parseKnowledgeEngineUseRecommendedSettings,
  resolveKnowledgeEngineConfig,
  mergeKnowledgeEngineIntoBehavior,
  parseOrgKnowledgeStore,
  shouldUseKnowledgeEngineRuntime,
} from "./knowledge/parseKnowledgeEngineConfig.js";
export type {
  KnowledgeEngineConfig,
  KnowledgeEngineOrgConfig,
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeInspectorTrace,
  KnowledgeProviderKind,
} from "./knowledge/knowledgeEngineTypes.js";
export { DEFAULT_KNOWLEDGE_ENGINE_CONFIG } from "./knowledge/knowledgeEngineTypes.js";
export { clearKnowledgeCache, getKnowledgeCacheStats } from "./knowledge/knowledgeCache.js";
export { runKnowledgeInspector } from "./knowledge/knowledgeInspectorService.js";
export { invalidateKnowledgeEngineCache } from "./knowledge/knowledgeArticleHooks.js";
export { buildTurnContext, analyzeIntent, buildExecutionContract } from "./core/buildTurnContext.js";
export { compilePromptContract } from "./compiler/PromptCompiler.js";
export {
  shouldBlockOutboundFromTurnContract,
  blockReasonFromTurnContract,
} from "./core/executionContractGate.js";
export {
  formatExecutionContractForSupervisor,
  executionContractViolationAlerts,
  executionContractRequiresBlock,
} from "./core/executionContractFormat.js";
export type {
  TurnContext,
  PromptContract,
  ExecutionContract,
  IntentAnalysis,
  IntentKind,
} from "./core/types.js";
export {
  planScheduledToolInvocations,
  buildScheduledToolArgs,
  shouldRunToolScheduler,
  formatScheduledToolsSystemAppendix,
  compactStructuredPayloadForPrompt,
} from "./scheduler/TurnToolScheduler.js";
export { invokeScheduledTools } from "./scheduler/invokeScheduledTools.js";
export type {
  ScheduledToolInvocation,
} from "./scheduler/TurnToolScheduler.js";
export type {
  ScheduledToolOutcome,
  InvokeScheduledToolsInput,
  InvokeScheduledToolsResult,
} from "./scheduler/invokeScheduledTools.js";
export {
  decideResilienceAction,
  parseResilienceConfig,
  DEFAULT_RESILIENCE_CONFIG,
} from "./resilience/TurnResilience.js";
export type {
  ResilienceActionKind,
  ResilienceConfig,
  ResilienceDecision,
} from "./resilience/TurnResilience.js";
export * from "./engine/index.js";
export * from "./continuation/index.js";
export * from "./simulator/index.js";
export {
  packMemoryForPrompt,
  resolveMemoryPriority,
  isMemoryExpired,
  estimatePackedTokens,
  DEFAULT_MEMORY_BUDGET_CONFIG,
  type MemoryBudgetConfig,
  type MemoryPackResult,
} from "./memory/MemoryBudgetPacker.js";
export {
  executeRuntimeStream,
  collectRuntimeStream,
  type StreamRuntimeEvent,
  type ExecuteStreamOpts,
} from "./runtime/StreamingRuntime.js";
export {
  ingestAgentTraceToOtel,
  buildOtelSpansFromTrace,
  isOtelExportConfigured,
  getRecentOtelSpans,
  type OtelSpan,
  type OtelExportResult,
} from "./observability/OtelBridge.js";
export {
  isLikelyStallOnlyReply,
  isToolNarrationReply,
  isNonDeliveringAgentReply,
  hasSubstantiveAgentReplyToCustomer,
  buildRuntimeOwnedReplyGuardAppendix,
} from "./reply/ReplyQuality.js";
export {
  ensureDeliveringReply,
  buildModeloS1FromReservationPayload,
  replyLooksLikeModeloS1,
  userMessageLooksLikeCheckInTurn,
  buildModeloS9TravelFormTemplate,
  buildModeloS10CheckInAck,
  extractReservationDisplayFields,
} from "./reply/ReplySynthesizer.js";
export {
  resolveActProgressMessage,
  logActProgress,
} from "./runtime/ProgressEmitter.js";

import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "./types.js";
import { parseAgentEngineConfig } from "./config/parseAgentEngineConfig.js";
import { AgentRuntimeFactory } from "./runtime/AgentRuntimeFactory.js";

function logAgentEngineTrace(
  input: AgentRuntimeExecuteInput,
  result: AgentRuntimeExecuteResult,
): void {
  if (input.engineConfig.observability !== "full" || !result.trace) return;
  input.executionLog?.info(
    { id: "agent_engine_trace", name: "Agent Engine Trace" },
    JSON.stringify(result.trace),
  );
}

/** Ponto de entrada único para execução via Agent Engine (retrocompatível — devolve só reply). */
export async function executeViaAgentEngine(input: AgentRuntimeExecuteInput): Promise<string> {
  const result = await executeViaAgentEngineWithResult(input);
  return result.reply;
}

/** Execução com trace completo (para inspectores e observabilidade avançada). */
export async function executeViaAgentEngineWithResult(
  input: AgentRuntimeExecuteInput,
): Promise<AgentRuntimeExecuteResult> {
  const runtime = AgentRuntimeFactory.create(input.engineConfig);
  const result = await runtime.execute(input);
  logAgentEngineTrace(input, result);
  return result;
}
