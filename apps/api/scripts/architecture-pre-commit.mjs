#!/usr/bin/env node
/** Pre-commit — evaluateProposedChange + patch checks on staged runtime files. */
import { runPreCommitArchitectureGate } from "../src/lib/architecture-governance/ciGate.js";

const result = await runPreCommitArchitectureGate();

console.log("=== OpenNexo Architecture Pre-Commit ===");
for (const g of result.gates) {
  const icon = g.passed ? "✔" : "✖";
  console.log(`${icon} ${g.id}${g.message ? `: ${g.message}` : ""}`);
}

if (!result.passed) {
  console.error("\nPre-commit architecture gate FAILED.");
  process.exit(1);
}

console.log("\nPre-commit architecture gate OK.");
