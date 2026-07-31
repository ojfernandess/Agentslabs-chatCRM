import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Resolve raiz do repositório (monorepo openconduit). */
export function resolveRepoRoot(startDir = process.cwd()): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "apps", "api")) && existsSync(join(dir, "docs"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

export function architectureDocsRoot(repoRoot?: string): string {
  return join(repoRoot ?? resolveRepoRoot(), "docs", "architecture");
}

export function adrDir(repoRoot?: string): string {
  return join(architectureDocsRoot(repoRoot), "adr");
}

export function rcaDir(repoRoot?: string): string {
  return join(architectureDocsRoot(repoRoot), "rca");
}
