#!/usr/bin/env node
/** Fase 9 — gera FINAL-AUDIT-YYYY-MM-DD.md */
import { runFinalArchitectureAudit, writeFinalAuditReport } from "../src/lib/architecture-governance/finalAudit.js";

const report = await runFinalArchitectureAudit();
const outPath = writeFinalAuditReport(report);

console.log("=== OpenNexo Final Architecture Audit ===");
console.log(`Architecture Score: ${report.architectureScoreFinal}/10`);
console.log(`Acceptance: ${report.acceptanceCriteria.filter((c) => c.passed).length}/${report.acceptanceCriteria.length}`);
console.log(`Result: ${report.passed ? "PASS" : "CONDITIONAL"}`);
console.log(`Report: ${outPath}`);

if (!report.passed) process.exit(1);
