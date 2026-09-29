let enqueueSuccessCount = 0;
let syncFallbackCount = 0;
let orgRateLimitDelayedCount = 0;

export function recordAgentEngineEnqueueSuccess(): void {
  enqueueSuccessCount += 1;
}

export function recordAgentEngineSyncFallback(): void {
  syncFallbackCount += 1;
}

export function recordAgentEngineOrgRateLimitDelayed(): void {
  orgRateLimitDelayedCount += 1;
}

export function getAgentEngineQueueMetrics(): {
  enqueueSuccessCount: number;
  syncFallbackCount: number;
  orgRateLimitDelayedCount: number;
  totalDispatchAttempts: number;
  syncFallbackRatePercent: number | null;
} {
  const total = enqueueSuccessCount + syncFallbackCount;
  return {
    enqueueSuccessCount,
    syncFallbackCount,
    orgRateLimitDelayedCount,
    totalDispatchAttempts: total,
    syncFallbackRatePercent: total > 0 ? Math.round((syncFallbackCount / total) * 10_000) / 100 : null,
  };
}

export function resetAgentEngineQueueMetrics(): void {
  enqueueSuccessCount = 0;
  syncFallbackCount = 0;
  orgRateLimitDelayedCount = 0;
}
