import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RootCauseRecord } from "./types.js";
import { rcaDir } from "./paths.js";

function rcaFilePath(id: string, repoRoot?: string): string {
  return join(rcaDir(repoRoot), `${id}.json`);
}

function nextRcaId(existing: RootCauseRecord[]): string {
  let max = 0;
  for (const r of existing) {
    const m = /^RCA-(\d+)$/i.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `RCA-${String(max + 1).padStart(4, "0")}`;
}

export function listRcas(repoRoot?: string): RootCauseRecord[] {
  const dir = rcaDir(repoRoot);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RootCauseRecord)
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export function getRca(id: string, repoRoot?: string): RootCauseRecord | null {
  try {
    return JSON.parse(readFileSync(rcaFilePath(id, repoRoot), "utf8")) as RootCauseRecord;
  } catch {
    return null;
  }
}

export function searchRcas(query: string, repoRoot?: string): RootCauseRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return listRcas(repoRoot);
  return listRcas(repoRoot).filter((r) => {
    const blob = [r.id, r.title, r.problem, r.rootCause, r.fixApplied, r.firstResponsibleComponent]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}

export function createRca(
  input: Omit<RootCauseRecord, "id" | "recurrenceCount"> & { id?: string; recurrenceCount?: number },
  repoRoot?: string,
): RootCauseRecord {
  const dir = rcaDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const existing = listRcas(repoRoot);
  const duplicate = existing.find(
    (r) => r.rootCause.trim().toLowerCase() === input.rootCause.trim().toLowerCase(),
  );
  if (duplicate) {
    const updated: RootCauseRecord = {
      ...duplicate,
      recurrenceCount: duplicate.recurrenceCount + 1,
      relatedAdrIds: [...new Set([...duplicate.relatedAdrIds, ...input.relatedAdrIds])],
      relatedCommits: [...new Set([...duplicate.relatedCommits, ...input.relatedCommits])],
    };
    writeFileSync(rcaFilePath(updated.id, repoRoot), JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }
  const rca: RootCauseRecord = {
    ...input,
    id: input.id ?? nextRcaId(existing),
    recurrenceCount: input.recurrenceCount ?? 1,
    relatedAdrIds: input.relatedAdrIds ?? [],
    relatedCommits: input.relatedCommits ?? [],
    categories: input.categories ?? ["Bug"],
  };
  writeFileSync(rcaFilePath(rca.id, repoRoot), JSON.stringify(rca, null, 2), "utf8");
  return rca;
}
