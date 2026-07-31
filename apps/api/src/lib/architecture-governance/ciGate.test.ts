import assert from "node:assert/strict";
import { test } from "node:test";
import { runArchitectureCiGates } from "./ciGate.js";

test("runArchitectureCiGates passes scan + simulator without file list", async () => {
  const result = await runArchitectureCiGates({ skipSimulator: false });
  const sim = result.gates.find((g) => g.id === "architecture_simulator");
  const scan = result.gates.find((g) => g.id === "scan_runtime_patches");
  assert.ok(sim);
  assert.equal(sim!.passed, true, sim!.message);
  assert.ok(scan);
  assert.equal(scan!.passed, true, scan!.message);
});

test("runArchitectureCiGates blocks low-score proposal", async () => {
  const result = await runArchitectureCiGates({
    modifiedFiles: ["apps/api/src/lib/agentNativeLlm.ts"],
    skipSimulator: true,
    skipPatchScan: true,
    skipPromptPatchCheck: true,
    minArchitectureScore: 10,
  });
  const scoreGate = result.gates.find((g) => g.id === "architecture_score");
  assert.ok(scoreGate);
  assert.equal(scoreGate!.passed, false);
  assert.equal(result.passed, false);
});
