import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runFinalArchitectureAudit,
  renderFinalAuditMarkdown,
} from "./finalAudit.js";

test("runFinalArchitectureAudit produces phase 9 report", async () => {
  const report = await runFinalArchitectureAudit();
  assert.equal(report.phase, 9);
  assert.ok(report.architectureScoreFinal >= 7);
  assert.ok(report.acceptanceCriteria.length >= 8);
  assert.ok(report.patchScan.totalHits > 0);
});

test("renderFinalAuditMarkdown includes ADR-0003 accepted", async () => {
  const report = await runFinalArchitectureAudit();
  const md = renderFinalAuditMarkdown(report);
  assert.match(md, /ADR-0003.*accepted/i);
  assert.match(md, /Clínica Veterinária|generalization/i);
});
