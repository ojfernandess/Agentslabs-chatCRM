import { execSync } from "node:child_process";
import { resolveRepoRoot } from "./paths.js";

export type GitMetadata = {
  branch: string;
  commit: string;
  author: string;
};

export function readGitMetadata(repoRoot?: string): GitMetadata {
  const cwd = repoRoot ?? resolveRepoRoot();
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
    const commit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim().slice(0, 12);
    const author = execSync("git log -1 --format=%an", { cwd, encoding: "utf8" }).trim();
    return { branch, commit, author };
  } catch {
    return { branch: "unknown", commit: "unknown", author: "unknown" };
  }
}

/** Ficheiros staged (pre-commit gate). */
export function readStagedFiles(repoRoot?: string): string[] {
  const cwd = repoRoot ?? resolveRepoRoot();
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function readCommitMetadata(commitish: string, repoRoot?: string): GitMetadata & { message: string } {
  const cwd = repoRoot ?? resolveRepoRoot();
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
    const commit = execSync(`git rev-parse ${commitish}`, { cwd, encoding: "utf8" }).trim().slice(0, 12);
    const author = execSync(`git log -1 --format=%an ${commitish}`, { cwd, encoding: "utf8" }).trim();
    const message = execSync(`git log -1 --format=%s ${commitish}`, { cwd, encoding: "utf8" }).trim();
    return { branch, commit, author, message };
  } catch {
    return { branch: "unknown", commit: commitish, author: "unknown", message: "" };
  }
}
