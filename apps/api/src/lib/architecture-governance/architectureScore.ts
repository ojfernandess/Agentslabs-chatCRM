import type { ArchitectureScoreSnapshot, ProposedChange } from "./types.js";
import { analyzeArchitectureImpact } from "./impactAnalysis.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

/** Heurística de score — melhora com módulos dedicados, testes e MCP; penaliza workarounds. */
export function computeArchitectureScore(proposal: ProposedChange): ArchitectureScoreSnapshot {
  const impact = analyzeArchitectureImpact(proposal.modifiedFiles);
  const blob = [
    proposal.reason,
    proposal.problem,
    proposal.technicalJustification ?? "",
    ...proposal.modifiedFiles,
  ].join("\n");

  let cohesion = 7;
  let lowCoupling = 7;
  let reuse = 6;
  let explainability = 6;
  let auditability = 5;
  let performance = 7;
  let reliability = 7;
  let testability = 6;
  let scalability = 7;
  let observability = 5;

  if (/architecture-governance|adr|rca/i.test(blob)) {
    auditability += 2;
    explainability += 2;
  }
  if (/\.test\.ts/i.test(blob)) testability += 2;
  if (/mcp\//i.test(blob)) observability += 2;
  if (/embraturReferenceDomains|componentRegistry|shared module/i.test(blob)) {
    reuse += 2;
    cohesion += 1;
  }

  if (/workaround|hotfix|patch específico|if \(.*auda/i.test(blob)) {
    reuse -= 2;
    cohesion -= 1;
    lowCoupling -= 1;
  }
  if (/agentNativeLlm\.ts/.test(blob) && proposal.modifiedFiles.length === 1) {
    lowCoupling -= 1;
    cohesion -= 1;
  }
  if (impact.severity === "critical") reliability -= 1;

  const dims = {
    cohesion: clamp(cohesion),
    lowCoupling: clamp(lowCoupling),
    reuse: clamp(reuse),
    explainability: clamp(explainability),
    auditability: clamp(auditability),
    performance: clamp(performance),
    reliability: clamp(reliability),
    testability: clamp(testability),
    scalability: clamp(scalability),
    observability: clamp(observability),
  };
  const total =
    Object.values(dims).reduce((a, b) => a + b, 0) / Object.keys(dims).length;

  return { ...dims, total: clamp(total) };
}

export function scoreRegression(
  before: ArchitectureScoreSnapshot,
  after: ArchitectureScoreSnapshot,
): number {
  return after.total - before.total;
}
