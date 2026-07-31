import { createAdr, getAdr, listAdrs, searchAdrs, writeAdrMarkdown } from "./adrStore.js";
import { createRca, listRcas, searchRcas } from "./rcaStore.js";
import { classifyChange, inferPrimaryComponent } from "./classifier.js";
import { analyzeArchitectureImpact } from "./impactAnalysis.js";
import { computeArchitectureScore } from "./architectureScore.js";
import { runQualityGates } from "./qualityGates.js";
import { runImplementationReview } from "./implementationReview.js";
import { runArchitectureReview } from "./architectureReviewer.js";
import { readGitMetadata } from "./gitMetadata.js";
import { resolveRepoRoot } from "./paths.js";
import type {
  ArchitectureDecisionRecord,
  CreateAdrInput,
  ProposedChange,
  RootCauseRecord,
} from "./types.js";

export type GovernancePackage = {
  proposal: ProposedChange;
  impact: ReturnType<typeof analyzeArchitectureImpact>;
  implementationReview: ReturnType<typeof runImplementationReview>;
  qualityGates: ReturnType<typeof runQualityGates>;
  architectureReview: ReturnType<typeof runArchitectureReview>;
  architectureScore: ReturnType<typeof computeArchitectureScore>;
  architecturalDone: boolean;
  missingArtifacts: string[];
};

function checkArchitecturalDone(pkg: GovernancePackage, adr?: ArchitectureDecisionRecord | null): string[] {
  const missing: string[] = [];
  if (!adr) missing.push("ADR");
  if (!pkg.implementationReview.similarRcas.length && pkg.proposal.rootCause) {
    /* RCA optional on first occurrence */
  }
  if (!pkg.impact) missing.push("Impact Analysis");
  if (!pkg.architectureReview.approved) missing.push("Architecture Review approval");
  if (!pkg.qualityGates.passed) missing.push("Quality Gates");
  if (pkg.architectureScore.total < 5) missing.push("Architecture Score >= 5");
  if (!pkg.proposal.architectureAfter?.trim()) missing.push("Architecture After documentation");
  if (!adr?.rollback?.trim()) missing.push("Rollback plan");
  return missing;
}

/** Análise completa pré-implementação. */
export function evaluateProposedChange(proposal: ProposedChange, repoRoot?: string): GovernancePackage {
  const root = repoRoot ?? resolveRepoRoot();
  const enriched: ProposedChange = {
    ...proposal,
    component: inferPrimaryComponent(proposal),
  };
  const impact = analyzeArchitectureImpact(enriched.modifiedFiles);
  const implementationReview = runImplementationReview(enriched, root);
  const qualityGates = runQualityGates(enriched);
  const architectureReview = runArchitectureReview(enriched);
  const architectureScore = computeArchitectureScore(enriched);

  const pkg: GovernancePackage = {
    proposal: enriched,
    impact,
    implementationReview,
    qualityGates,
    architectureReview,
    architectureScore,
    architecturalDone: false,
    missingArtifacts: [],
  };
  pkg.missingArtifacts = checkArchitecturalDone(pkg);
  pkg.architecturalDone = pkg.missingArtifacts.length === 0 && architectureReview.approved;
  return pkg;
}

/** Regista ADR + RCA após implementação aceite. */
export function recordArchitectureDecision(input: {
  proposal: ProposedChange;
  adr?: Partial<CreateAdrInput>;
  rca?: Partial<Omit<RootCauseRecord, "id">>;
  repoRoot?: string;
}): { adr: ArchitectureDecisionRecord; rca?: RootCauseRecord } {
  const root = input.repoRoot ?? resolveRepoRoot();
  const git = readGitMetadata(root);
  const categories = classifyChange({
    modifiedFiles: input.proposal.modifiedFiles,
    reason: input.proposal.reason,
    problem: input.proposal.problem,
    explicitCategories: input.proposal.categories,
  });
  const score = computeArchitectureScore(input.proposal);
  const impact = analyzeArchitectureImpact(input.proposal.modifiedFiles);

  const adr = createAdr(
    {
      title: input.proposal.title,
      author: input.adr?.author ?? git.author,
      branch: input.adr?.branch ?? git.branch,
      commit: input.adr?.commit ?? git.commit,
      component: inferPrimaryComponent(input.proposal),
      modifiedFiles: input.proposal.modifiedFiles,
      reason: input.proposal.reason,
      categories,
      problem: input.proposal.problem,
      rootCause: input.proposal.rootCause,
      alternativesAnalyzed: input.proposal.alternativesAnalyzed ?? [],
      alternativesDiscarded: input.proposal.alternativesDiscarded ?? [],
      technicalJustification: input.proposal.technicalJustification ?? "",
      architectureBefore: input.proposal.architectureBefore ?? "",
      architectureAfter: input.proposal.architectureAfter ?? "",
      expectedImpact:
        input.adr?.expectedImpact ??
        (impact.possibleRegressions.join("; ") || "Ver impact analysis"),
      risks: input.adr?.risks ?? impact.possibleRegressions,
      rollback: input.adr?.rollback ?? `Revert commit ${git.commit}; restaurar flowSlots e desactivar guardas novos.`,
      testsExecuted: input.adr?.testsExecuted ?? [],
      testResult: input.adr?.testResult ?? "pending",
      references: input.adr?.references ?? [],
      architectureScore: score,
      ...input.adr,
    },
    root,
  );
  writeAdrMarkdown(adr, root);

  let rca: RootCauseRecord | undefined;
  if (input.proposal.rootCause?.trim()) {
    rca = createRca(
      {
        title: input.proposal.title,
        date: new Date().toISOString().slice(0, 10),
        problem: input.proposal.problem,
        firstResponsibleComponent: inferPrimaryComponent(input.proposal),
        lastImpactedComponent: impact.affectedComponents[impact.affectedComponents.length - 1] ?? "Runtime",
        rootCause: input.proposal.rootCause,
        fixApplied: input.proposal.architectureAfter ?? adr.technicalJustification,
        relatedAdrIds: [adr.id],
        relatedCommits: [git.commit],
        categories,
        ...input.rca,
      },
      root,
    );
  }

  return { adr, rca };
}

export function getArchitectureTimeline(repoRoot?: string) {
  const root = repoRoot ?? resolveRepoRoot();
  return {
    adrs: listAdrs(root).map((a) => ({
      id: a.id,
      title: a.title,
      date: a.date,
      component: a.component,
      commit: a.commit,
      status: a.status,
      categories: a.categories,
    })),
    rcas: listRcas(root).map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      recurrenceCount: r.recurrenceCount,
      relatedAdrIds: r.relatedAdrIds,
    })),
  };
}

export { listAdrs, getAdr, searchAdrs, listRcas, searchRcas };
