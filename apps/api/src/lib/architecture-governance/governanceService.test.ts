import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyChange } from "./classifier.js";
import { analyzeArchitectureImpact } from "./impactAnalysis.js";
import { computeArchitectureScore } from "./architectureScore.js";
import { runQualityGates } from "./qualityGates.js";
import { runArchitectureReview } from "./architectureReviewer.js";
import { listAdrs, getAdr } from "./adrStore.js";
import { listRcas, createRca } from "./rcaStore.js";
import { evaluateProposedChange, getArchitectureTimeline } from "./governanceService.js";
import { AGS_CATEGORIES } from "./types.js";

const EMBRATUR_PROPOSAL = {
  title: "Embratur FNRH resolver",
  reason: "Fix check-in with FNRH reference domains",
  problem: "Check-in failed silently for foreign countries",
  rootCause: "Static IBGE catalog and premature __completionReady",
  modifiedFiles: [
    "apps/api/src/lib/agent-engine/checkin/embraturReferenceResolver.ts",
    "apps/api/src/lib/agent-engine/checkin/embraturRuntimeGuards.test.ts",
  ],
  architectureBefore: "Static catalog; HTTP 200 always ok",
  architectureAfter: "FNRH resolver; validationError marks failure; runtime guards",
  technicalJustification: "Generic playbook runtime via embratur-reference tool (ADR-0002).",
};

test("classifyChange never returns empty and uses valid categories only", () => {
  const cats = classifyChange({ modifiedFiles: ["apps/api/src/lib/mcp/server/createMcpServer.ts"] });
  assert.ok(cats.length > 0);
  for (const c of cats) {
    assert.ok((AGS_CATEGORIES as readonly string[]).includes(c));
    assert.notEqual(c, "Outros");
  }
});

test("classifyChange detects Scheduler and Bug from paths", () => {
  const cats = classifyChange({
    modifiedFiles: ["apps/api/src/lib/agent-engine/scheduler/TurnToolScheduler.ts"],
    problem: "fix scheduler bug",
  });
  assert.ok(cats.includes("Scheduler"));
  assert.ok(cats.includes("Bug"));
});

test("analyzeArchitectureImpact maps agent-engine files to components", () => {
  const impact = analyzeArchitectureImpact([
    "apps/api/src/lib/agent-engine/scheduler/TurnToolScheduler.ts",
    "apps/api/src/lib/agentNativeLlm.ts",
  ]);
  assert.ok(impact.affectedComponents.length > 0);
  assert.ok(["low", "medium", "high", "critical"].includes(impact.severity));
});

test("computeArchitectureScore returns total between 0 and 10", () => {
  const score = computeArchitectureScore(EMBRATUR_PROPOSAL);
  assert.ok(score.total >= 0 && score.total <= 10);
  assert.ok(score.total >= 5);
});

test("runQualityGates blocks workaround patterns", () => {
  const gates = runQualityGates({
    ...EMBRATUR_PROPOSAL,
    technicalJustification: "hotfix workaround for botId",
  });
  assert.equal(gates.passed, false);
  assert.ok(gates.violations.some((v) => v.gate === "no_workaround"));
});

test("runArchitectureReview approves well-documented Embratur proposal", () => {
  const review = runArchitectureReview(EMBRATUR_PROPOSAL);
  assert.equal(review.approved, true);
  assert.equal(review.resolvesRootCause, true);
});

test("evaluateProposedChange returns governance package", () => {
  const pkg = evaluateProposedChange(EMBRATUR_PROPOSAL);
  assert.ok(pkg.impact);
  assert.ok(pkg.implementationReview);
  assert.ok(pkg.qualityGates);
  assert.ok(pkg.architectureReview);
  assert.ok(pkg.architectureScore.total >= 5);
});

test("seed ADRs ADR-0001 and ADR-0002 are loadable from repo", () => {
  const adrs = listAdrs();
  assert.ok(adrs.length >= 2);
  const ags = getAdr("ADR-0001");
  const embratur = getAdr("ADR-0002");
  assert.ok(ags);
  assert.ok(embratur);
  assert.equal(embratur!.commit, "92dda4d");
});

test("RCA deduplication increments recurrenceCount", () => {
  const root = mkdtempSync(join(tmpdir(), "ags-rca-"));
  try {
    const first = createRca(
      {
        title: "Test RCA",
        date: "2026-07-30",
        problem: "p",
        firstResponsibleComponent: "Runtime",
        lastImpactedComponent: "Scheduler",
        rootCause: "unique root cause for test",
        fixApplied: "fix",
        relatedAdrIds: ["ADR-0002"],
        relatedCommits: ["abc"],
        categories: ["Bug"],
      },
      root,
    );
    const second = createRca(
      {
        title: "Test RCA again",
        date: "2026-07-30",
        problem: "p2",
        firstResponsibleComponent: "Runtime",
        lastImpactedComponent: "Scheduler",
        rootCause: "unique root cause for test",
        fixApplied: "fix2",
        relatedAdrIds: ["ADR-0002"],
        relatedCommits: ["def"],
        categories: ["Bug"],
      },
      root,
    );
    assert.equal(first.id, second.id);
    assert.equal(second.recurrenceCount, 2);
    assert.equal(listRcas(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getArchitectureTimeline includes ADRs and RCAs", () => {
  const timeline = getArchitectureTimeline();
  assert.ok(Array.isArray(timeline.adrs));
  assert.ok(Array.isArray(timeline.rcas));
  assert.ok(timeline.adrs.some((a) => a.id === "ADR-0001"));
});
