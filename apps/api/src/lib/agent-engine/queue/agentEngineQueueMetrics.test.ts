import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAgentEngineQueueMetrics,
  recordAgentEngineEnqueueSuccess,
  recordAgentEngineSyncFallback,
  resetAgentEngineQueueMetrics,
} from "./agentEngineQueueMetrics.js";

test("agentEngineQueueMetrics tracks enqueue vs sync fallback", () => {
  resetAgentEngineQueueMetrics();
  recordAgentEngineEnqueueSuccess();
  recordAgentEngineEnqueueSuccess();
  recordAgentEngineSyncFallback();

  const metrics = getAgentEngineQueueMetrics();
  assert.equal(metrics.enqueueSuccessCount, 2);
  assert.equal(metrics.syncFallbackCount, 1);
  assert.equal(metrics.totalDispatchAttempts, 3);
  assert.equal(metrics.syncFallbackRatePercent, 33.33);
});
