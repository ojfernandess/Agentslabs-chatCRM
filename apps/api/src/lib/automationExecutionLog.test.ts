import assert from "node:assert/strict";
import test from "node:test";
import { automationLogSeverityRank } from "./automationExecutionLogLevel.js";

test("automationLogSeverityRank orders DEBUG < FATAL", () => {
  assert.ok(automationLogSeverityRank("DEBUG") < automationLogSeverityRank("INFO"));
  assert.ok(automationLogSeverityRank("WARN") < automationLogSeverityRank("ERROR"));
  assert.ok(automationLogSeverityRank("ERROR") < automationLogSeverityRank("FATAL"));
});
