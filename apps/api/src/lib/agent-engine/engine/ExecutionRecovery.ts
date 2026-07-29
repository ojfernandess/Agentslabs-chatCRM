import {
  decideResilienceAction,
  parseResilienceConfig,
  type ResilienceDecision,
} from "../resilience/TurnResilience.js";
import type { AgentEngineConfig, AgentSupervisorTrace } from "../types.js";
import type { ExecutionContract } from "../core/types.js";

export type EngineRecoveryOpts = {
  engineConfig: AgentEngineConfig;
  behaviorConfig?: Record<string, unknown> | null;
  supervisorTrace?: AgentSupervisorTrace | null;
  executionContract?: ExecutionContract | null;
  retryCount: number;
  recoveryCount: number;
  previousReply?: string;
  replyText?: string;
  toolOutcomes?: Array<{ name: string; ok: boolean }>;
};

/** Adapta TurnResilience à API da Execution Engine. */
export function decideEngineRecovery(opts: EngineRecoveryOpts): ResilienceDecision {
  const config = parseResilienceConfig(opts.engineConfig, opts.behaviorConfig);
  return decideResilienceAction({
    config,
    strictMode: opts.engineConfig.strictMode,
    supervisorTrace: opts.supervisorTrace,
    executionContract: opts.executionContract,
    retryCount: opts.retryCount,
    recoveryCount: opts.recoveryCount,
    previousReply: opts.previousReply,
    replyText: opts.replyText,
    toolOutcomes: opts.toolOutcomes,
  });
}
