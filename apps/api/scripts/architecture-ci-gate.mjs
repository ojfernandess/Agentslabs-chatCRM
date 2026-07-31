#!/usr/bin/env node
/** CI pipeline — architecture gates completos (Fase 8). */
import { runArchitectureCiGates } from "../src/lib/architecture-governance/ciGate.js";

const skipSim = process.argv.includes("--skip-simulator");
const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const result = await runArchitectureCiGates({
  modifiedFiles: files.length ? files : undefined,
  skipSimulator: skipSim,
});

console.log("=== OpenNexo Architecture CI Gates ===");
for (const g of result.gates) {
  const icon = g.passed ? "✔" : "✖";
  console.log(`${icon} [${g.blocking ? "blocking" : "info"}] ${g.id}${g.message ? `: ${g.message}` : ""}`);
}

if (!result.passed) {
  console.error("\nArchitecture CI gates FAILED.");
  process.exit(1);
}

console.log("\nArchitecture CI gates OK.");
