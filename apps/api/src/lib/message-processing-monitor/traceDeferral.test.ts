import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeDeferredMessageTrace,
  deferMessageTraceFinish,
  finishMessageTrace,
} from "./service.js";
import { createTraceHandle } from "./traceContext.js";
import type { MessageProcessingTrace } from "./types.js";

function makeTrace(): MessageProcessingTrace {
  const now = new Date().toISOString();
  return {
    traceId: "MSG-TEST-001",
    environment: "test",
    direction: "INBOUND",
    organizationId: "org-1",
    startedAt: now,
    status: "running",
    spans: [],
    queries: [],
    querySummary: { total: 0, totalDurationMs: 0, slowestMs: 0, repeatedPatterns: [] },
    counters: {},
    events: [],
    anomalies: [],
    realtime: { emits: 0, recipients: 0, payloadBytes: 0 },
    snapshots: {
      before: {
        at: now,
        processCpuPercent: 0,
        serverCpuPercent: null,
        processMemoryMb: 0,
        serverMemoryUsedMb: null,
        serverMemoryTotalMb: null,
        heapUsedMb: 0,
        heapTotalMb: 0,
        rssMb: 0,
        eventLoopLagMs: 0,
        eventLoopUtilization: null,
      },
      peak: {
        at: now,
        processCpuPercent: 0,
        serverCpuPercent: null,
        processMemoryMb: 0,
        serverMemoryUsedMb: null,
        serverMemoryTotalMb: null,
        heapUsedMb: 0,
        heapTotalMb: 0,
        rssMb: 0,
        eventLoopLagMs: 0,
        eventLoopUtilization: null,
      },
      after: {
        at: now,
        processCpuPercent: 0,
        serverCpuPercent: null,
        processMemoryMb: 0,
        serverMemoryUsedMb: null,
        serverMemoryTotalMb: null,
        heapUsedMb: 0,
        heapTotalMb: 0,
        rssMb: 0,
        eventLoopLagMs: 0,
        eventLoopUtilization: null,
      },
    },
    bot: {},
    meta: {},
  };
}

describe("message trace deferral", () => {
  it("finishMessageTrace is ignored while deferred", () => {
    let finished = 0;
    const handle = createTraceHandle(makeTrace(), () => {
      finished += 1;
    });
    deferMessageTraceFinish(handle);
    handle.recordQuery("Message", "findMany", 5);
    finishMessageTrace(handle, "completed");
    assert.equal(finished, 0);
    assert.equal(handle.trace.queries.length, 1);
  });

  it("completeDeferredMessageTrace finalizes with accumulated queries", () => {
    let finished = 0;
    const handle = createTraceHandle(makeTrace(), () => {
      finished += 1;
    });
    deferMessageTraceFinish(handle);
    handle.recordQuery("AutomationCustomTool", "findMany", 12);
    handle.recordQuery("Message", "findMany", 8);
    completeDeferredMessageTrace(handle, "completed");
    assert.equal(finished, 1);
    assert.equal(handle.trace.querySummary.total, 2);
    assert.equal(handle.trace.status, "completed");
  });

  it("second completeDeferredMessageTrace is a no-op", () => {
    let finished = 0;
    const handle = createTraceHandle(makeTrace(), () => {
      finished += 1;
    });
    deferMessageTraceFinish(handle);
    completeDeferredMessageTrace(handle, "completed");
    completeDeferredMessageTrace(handle, "completed");
    assert.equal(finished, 1);
  });
});
