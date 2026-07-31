/** Architecture Governance System (AGS) — tipos centrais. */

export const AGS_CATEGORIES = [
  "Architecture",
  "Performance",
  "Bug",
  "Refactoring",
  "Feature",
  "Security",
  "Memory",
  "Workflow",
  "Planner",
  "Scheduler",
  "Supervisor",
  "Workflow Validator",
  "Prompt Compiler",
  "Capability Graph",
  "Facts Engine",
  "Streaming",
  "Observabilidade",
  "Runtime",
  "Tool Runtime",
] as const;

export type AgsCategory = (typeof AGS_CATEGORIES)[number];

export type AdrStatus = "proposed" | "accepted" | "deprecated" | "superseded";

export type ArchitectureDecisionRecord = {
  id: string;
  title: string;
  date: string;
  author: string;
  version: string;
  branch: string;
  commit: string;
  component: string;
  modifiedFiles: string[];
  reason: string;
  categories: AgsCategory[];
  problem: string;
  rootCause: string;
  alternativesAnalyzed: string[];
  alternativesDiscarded: string[];
  technicalJustification: string;
  architectureBefore: string;
  architectureAfter: string;
  expectedImpact: string;
  actualImpact: string;
  risks: string[];
  rollback: string;
  testsExecuted: string[];
  testResult: string;
  status: AdrStatus;
  references: string[];
  architectureScore?: ArchitectureScoreSnapshot;
  supersededBy?: string;
};

export type RootCauseRecord = {
  id: string;
  title: string;
  date: string;
  problem: string;
  firstResponsibleComponent: string;
  lastImpactedComponent: string;
  rootCause: string;
  fixApplied: string;
  relatedAdrIds: string[];
  relatedCommits: string[];
  recurrenceCount: number;
  categories: AgsCategory[];
};

export type ArchitectureScoreSnapshot = {
  cohesion: number;
  lowCoupling: number;
  reuse: number;
  explainability: number;
  auditability: number;
  performance: number;
  reliability: number;
  testability: number;
  scalability: number;
  observability: number;
  total: number;
};

export type ImpactAnalysisResult = {
  changedFiles: string[];
  affectedComponents: string[];
  dependencies: string[];
  couplings: string[];
  possibleRegressions: string[];
  agentImpact: string[];
  workflowImpact: string[];
  toolImpact: string[];
  memoryImpact: string[];
  schedulerImpact: string[];
  plannerImpact: string[];
  runtimeImpact: string[];
  severity: "low" | "medium" | "high" | "critical";
  requiresArchitecturalReview: boolean;
};

export type QualityGateViolation = {
  gate: string;
  message: string;
  blocking: boolean;
};

export type QualityGateResult = {
  passed: boolean;
  violations: QualityGateViolation[];
  scoreDelta: number;
};

export type ImplementationReviewResult = {
  similarAdrs: ArchitectureDecisionRecord[];
  similarRcas: RootCauseRecord[];
  recurringProblems: string[];
  relatedComponents: string[];
  reuseRecommendation: string;
  shouldReuseExisting: boolean;
};

export type ArchitectureReviewResult = {
  approved: boolean;
  resolvesRootCause: boolean;
  betterComponentExists: boolean;
  increasesTechnicalDebt: boolean;
  createsDependencies: boolean;
  createsExceptions: boolean;
  reducesReuse: boolean;
  betterAlternativeExists: boolean;
  findings: string[];
  blockers: string[];
};

export type CreateAdrInput = Omit<
  ArchitectureDecisionRecord,
  "id" | "date" | "version" | "status" | "actualImpact"
> & {
  id?: string;
  status?: AdrStatus;
  actualImpact?: string;
};

export type ProposedChange = {
  title: string;
  reason: string;
  problem: string;
  rootCause: string;
  modifiedFiles: string[];
  component?: string;
  categories?: AgsCategory[];
  architectureBefore?: string;
  architectureAfter?: string;
  technicalJustification?: string;
  alternativesAnalyzed?: string[];
  alternativesDiscarded?: string[];
};
