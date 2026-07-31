import { analyzeArchitectureImpact } from "./impactAnalysis.js";
import { computeArchitectureScore } from "./architectureScore.js";
import { runQualityGates } from "./qualityGates.js";
import type { ArchitectureReviewResult, ProposedChange } from "./types.js";

/**
 * Architecture Reviewer — análise determinística (base para agente IA permanente).
 */
export function runArchitectureReview(proposal: ProposedChange): ArchitectureReviewResult {
  const findings: string[] = [];
  const blockers: string[] = [];
  const gates = runQualityGates(proposal);
  const impact = analyzeArchitectureImpact(proposal.modifiedFiles);
  const score = computeArchitectureScore(proposal);

  const resolvesRootCause = Boolean(proposal.rootCause?.trim() && proposal.architectureAfter?.trim());
  if (!resolvesRootCause) {
    findings.push("Causa raiz ou arquitetura depois não documentada.");
  }

  const betterComponentExists =
    proposal.modifiedFiles.some((f) => /agentNativeLlm\.ts$/.test(f)) &&
    proposal.modifiedFiles.length === 1 &&
    !/agent-engine\//.test(proposal.modifiedFiles[0] ?? "");
  if (betterComponentExists) {
    findings.push("Lógica em agentNativeLlm.ts — preferir módulo em agent-engine/.");
  }

  const increasesTechnicalDebt = gates.violations.some((v) => v.gate === "no_workaround");
  const createsDependencies = impact.couplings.length > 2;
  const createsExceptions = /except|bypass|skip/i.test(proposal.architectureAfter ?? "");
  const reducesReuse = score.reuse < 5;
  const betterAlternativeExists = betterComponentExists && !createsExceptions;

  if (increasesTechnicalDebt) blockers.push("Introduz workaround ou patch específico.");
  if (!gates.passed) blockers.push(...gates.violations.filter((v) => v.blocking).map((v) => v.message));
  if (impact.requiresArchitecturalReview && score.total < 6) {
    blockers.push("Impacto elevado com score arquitetural insuficiente.");
  }
  if (reducesReuse && createsExceptions) {
    blockers.push("Reduz reutilização e cria exceções.");
  }

  const approved = blockers.length === 0;

  return {
    approved,
    resolvesRootCause,
    betterComponentExists,
    increasesTechnicalDebt,
    createsDependencies,
    createsExceptions,
    reducesReuse,
    betterAlternativeExists,
    findings,
    blockers,
  };
}
