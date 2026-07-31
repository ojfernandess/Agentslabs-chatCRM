#!/usr/bin/env node
/**
 * Check prompt-specific patches — Fase 8 CI gate.
 * Exit 1 se patterns proibidos em ficheiros alterados (ou agent-engine default).
 *
 * Usage:
 *   node apps/api/scripts/check-prompt-specific-patches.mjs
 *   node apps/api/scripts/check-prompt-specific-patches.mjs apps/api/src/lib/agentNativeLlm.ts
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { scanContentForPromptPatches, PROMPT_SPECIFIC_PATCH_PATTERNS, PROMPT_SPECIFIC_LEGACY_PATTERNS } from "../eslint-rules/no-prompt-specific-patches.js";

const ROOT = join(import.meta.dirname, "..");
const DEFAULT_DIRS = [join(ROOT, "src/lib/agent-engine"), join(ROOT, "src/lib/agentNativeLlm.ts")];
const SKIP = /\.test\.(ts|tsx)$/;

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return [];
    if (SKIP.test(path)) return [];
    return [path];
  }
  const out = [];
  for (const entry of readdirSync(path)) {
    out.push(...collectFiles(join(path, entry)));
  }
  return out;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const reportOnly = process.argv.includes("--report-legacy");

if (args.length === 0 && !reportOnly) {
  console.log("Prompt-specific patch check: pass file paths (pre-commit/CI) or --report-legacy.");
  process.exit(0);
}

const files =
  args.length > 0
    ? args.map((a) => (a.startsWith("/") || /^[A-Za-z]:/.test(a) ? a : join(process.cwd(), a)))
    : DEFAULT_DIRS.flatMap(collectFiles);

const patterns = reportOnly
  ? [...PROMPT_SPECIFIC_PATCH_PATTERNS, ...PROMPT_SPECIFIC_LEGACY_PATTERNS]
  : PROMPT_SPECIFIC_PATCH_PATTERNS;

function scanWithPatterns(content, relPath) {
  const hits = [];
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      hits.push({
        pattern: pattern.id,
        rel: relPath,
        line,
        message: pattern.message,
        snippet: m[0].slice(0, 80),
      });
    }
  }
  return hits;
}

const repoRoot = join(ROOT, "..", "..");
const allHits = [];
for (const file of files) {
  try {
    const content = readFileSync(file, "utf8");
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    allHits.push(...scanWithPatterns(content, rel));
  } catch {
    /* skip missing */
  }
}

console.log("=== Prompt-Specific Patch Check ===");
console.log(`Files: ${files.length}`);
console.log(`Hits: ${allHits.length}\n`);

for (const h of allHits.slice(0, 30)) {
  console.log(`  ${h.pattern} ${h.rel}:${h.line} — ${h.message}`);
}

if (allHits.length > 0) {
  console.error(`\nFAIL: ${allHits.length} prompt-specific patch pattern(s) found.`);
  process.exit(1);
}

console.log("OK — no forbidden prompt-specific patterns.");
