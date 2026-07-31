import assert from "node:assert/strict";
import { test } from "node:test";
import { runArchitectureSimulator, ARCHITECTURE_SIM_SCENARIOS } from "./simulator.js";

test("runArchitectureSimulator passes vet + hotel scenarios", async () => {
  const result = await runArchitectureSimulator();
  if (!result.passed) {
    for (const r of result.results) {
      if (!r.passed) {
        console.error(r.scenarioId, r.warnings);
      }
    }
  }
  assert.equal(result.passed, true);
  assert.equal(result.results.length, ARCHITECTURE_SIM_SCENARIOS.length);
});
