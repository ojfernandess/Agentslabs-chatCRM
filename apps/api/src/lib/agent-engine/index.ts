export * from "./types.js";
export { parseAgentEngineConfig, mergeAgentEngineIntoBehavior } from "./config/parseAgentEngineConfig.js";
export type { AgentRuntime } from "./runtime/AgentRuntime.js";
export { AgentRuntimeFactory } from "./runtime/AgentRuntimeFactory.js";
export { OpenNexoRuntime, type NativeAgentExecutor } from "./runtime/OpenNexoRuntime.js";
export { LangGraphRuntime } from "./runtime/LangGraphRuntime.js";
export { CrewAIRuntime } from "./runtime/CrewAIRuntime.js";
export { AutoGenRuntime } from "./runtime/AutoGenRuntime.js";
export { MastraRuntime } from "./runtime/MastraRuntime.js";
export { validateToolExecution } from "./validators/ToolValidator.js";
export { validateAgentPrompt } from "./validators/PromptValidator.js";
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
  shouldRetryAfterSupervisor,
} from "./supervisor/AgentSupervisorService.js";
export { ExecutionTraceBuilder } from "./observability/ExecutionTrace.js";

import type { AgentRuntimeExecuteInput } from "./types.js";
import { parseAgentEngineConfig } from "./config/parseAgentEngineConfig.js";
import { AgentRuntimeFactory } from "./runtime/AgentRuntimeFactory.js";

/** Ponto de entrada único para execução via Agent Engine. */
export async function executeViaAgentEngine(input: AgentRuntimeExecuteInput): Promise<string> {
  const runtime = AgentRuntimeFactory.create(input.engineConfig);
  const result = await runtime.execute(input);
  return result.reply;
}
