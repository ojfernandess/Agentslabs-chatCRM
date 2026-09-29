import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePlatformAlerts } from "./platformAlerts.js";

test("evaluatePlatformAlerts flags high CPU", () => {
  const alerts = evaluatePlatformAlerts({ processCpuPercent: 900, eventLoopLagMs: 1 });
  assert.ok(alerts.some((a) => a.code === "CPU_HIGH"));
});

test("evaluatePlatformAlerts flags event loop lag", () => {
  const alerts = evaluatePlatformAlerts({ processCpuPercent: 1, eventLoopLagMs: 10_000 });
  assert.ok(alerts.some((a) => a.code === "EVENT_LOOP_LAG"));
});
