import type { ProposedChange, QualityGateResult, QualityGateViolation } from "./types.js";
import { computeArchitectureScore } from "./architectureScore.js";

const WORKAROUND_PATTERNS = [
  /\bworkaround\b/i,
  /\bhotfix\b/i,
  /\bpatch\s+espec[ií]fico\b/i,
  /\bif\s*\(\s*botId/i,
  /\bif\s*\(\s*conversationId/i,
  /\bTODO:\s*remove/i,
];

export function runQualityGates(proposal: ProposedChange): QualityGateResult {
  const violations: QualityGateViolation[] = [];
  const blob = [
    proposal.reason,
    proposal.problem,
    proposal.technicalJustification ?? "",
    proposal.architectureAfter ?? "",
  ].join("\n");

  for (const re of WORKAROUND_PATTERNS) {
    if (re.test(blob)) {
      violations.push({
        gate: "no_workaround",
        message: `Possível workaround detectado: ${re.source}`,
        blocking: true,
      });
    }
  }

  const hasTests = proposal.modifiedFiles.some((f) => f.includes(".test.ts"));
  const touchesRuntime =
    proposal.modifiedFiles.some((f) => /agent-engine|agentNativeLlm|automationHttp/.test(f)) &&
    !proposal.modifiedFiles.every((f) => f.includes(".test.ts"));

  if (touchesRuntime && !hasTests) {
    violations.push({
      gate: "test_coverage",
      message: "Alteração de runtime sem ficheiro de teste associado.",
      blocking: false,
    });
  }

  if (touchesRuntime && !/adr|architecture-governance|document/i.test(blob)) {
    violations.push({
      gate: "adr_required",
      message: "Alteração estrutural requer ADR (Architecture Governance).",
      blocking: true,
    });
  }

  const score = computeArchitectureScore(proposal);
  if (score.total < 5.5) {
    violations.push({
      gate: "architecture_score",
      message: `Architecture Score baixo (${score.total}/10).`,
      blocking: true,
    });
  }

  const blocking = violations.filter((v) => v.blocking);
  return {
    passed: blocking.length === 0,
    violations,
    scoreDelta: 0,
  };
}
