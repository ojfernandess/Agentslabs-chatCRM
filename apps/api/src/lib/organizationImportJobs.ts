import { randomUUID } from "node:crypto";
import type { OrganizationImportResult } from "./organizationDataImport.js";

export type OrgImportJobPhase = "contacts" | "conversations" | "messages" | "done";

export type OrgImportJobState = {
  jobId: string;
  organizationId: string;
  status: "running" | "completed" | "failed";
  phase: OrgImportJobPhase;
  percent: number;
  processed: number;
  total: number;
  result?: OrganizationImportResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, OrgImportJobState>();
const JOB_TTL_MS = 30 * 60 * 1000;

function pruneOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createOrgImportJob(organizationId: string): string {
  pruneOldJobs();
  const jobId = randomUUID();
  const now = Date.now();
  jobs.set(jobId, {
    jobId,
    organizationId,
    status: "running",
    phase: "contacts",
    percent: 0,
    processed: 0,
    total: 0,
    createdAt: now,
    updatedAt: now,
  });
  return jobId;
}

export function updateOrgImportJob(jobId: string, patch: Partial<Omit<OrgImportJobState, "jobId" | "organizationId" | "createdAt">>): void {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
}

export function getOrgImportJob(jobId: string, organizationId?: string): OrgImportJobState | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (organizationId && job.organizationId !== organizationId) return null;
  return job;
}
