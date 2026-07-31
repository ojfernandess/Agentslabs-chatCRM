#!/usr/bin/env node
/**
 * Scan runtime patches — Fase 0 baseline + CI gate (Fase 8).
 *
 * Detecta patterns proibidos no agent-engine e agentNativeLlm.
 * Exit 0 = scan completo; exit 1 = novos patches acima do baseline.
 *
 * Usage:
 *   node apps/api/scripts/scan-runtime-patches.mjs
 *   node apps/api/scripts/scan-runtime-patches.mjs --fail-on-new
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = [
  join(ROOT, "src/lib/agent-engine"),
  join(ROOT, "src/lib/agentNativeLlm.ts"),
];
const SKIP = /\.test\.ts$/;
const BASELINE_COUNTS = {
  "prompt.includes": 0,
  "tool-name-regex": 41,
  embratur: 97,
  "modelo-s": 24,
  audaar: 7,
  "check-in-regex": 259,
};

const PATTERNS = [
  { id: "prompt.includes", re: /prompt\.includes\s*\(/gi },
  { id: "tool-name-regex", re: /\/(?:embratur|check[_-]?in|consultar[_-]?reserva|audaar)[^/]*\/[a-z]*(?:i|g)?\b/gi },
  { id: "embratur", re: /\bembratur\b/gi },
  { id: "modelo-s", re: /Modelo\s+S\d|buildModeloS\d/gi },
  { id: "audaar", re: /\baudaar\b/gi },
  { id: "check-in-regex", re: /check[_-]?in|checkin/gi },
];

function collectTsFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".ts") && !SKIP.test(path) ? [path] : [];
  const out = [];
  for (const entry of readdirSync(path)) {
    out.push(...collectTsFiles(join(path, entry)));
  }
  return out;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const rel = relative(join(ROOT, "..", ".."), filePath).replace(/\\/g, "/");
  const hits = [];
  for (const { id, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      hits.push({ pattern: id, line, rel, snippet: m[0].slice(0, 60) });
    }
  }
  return hits;
}

const failOnNew = process.argv.includes("--fail-on-new");
const files = SCAN_DIRS.flatMap(collectTsFiles);
const allHits = files.flatMap(scanFile);

const byPattern = {};
for (const h of allHits) {
  byPattern[h.pattern] = (byPattern[h.pattern] ?? 0) + 1;
}

console.log("=== OpenNexo Runtime Patch Scan ===");
console.log(`Files scanned: ${files.length}`);
console.log(`Total hits: ${allHits.length}\n`);

for (const [id, count] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
  const baseline = BASELINE_COUNTS[id];
  const delta = baseline != null ? count - baseline : null;
  const flag = delta != null && delta > 0 ? " ⚠️ NEW" : "";
  console.log(`  ${id}: ${count}${baseline != null ? ` (baseline ${baseline}, Δ${delta})` : ""}${flag}`);
}

if (failOnNew) {
  let failed = false;
  for (const [id, baseline] of Object.entries(BASELINE_COUNTS)) {
    const current = byPattern[id] ?? 0;
    if (current > baseline) {
      console.error(`\nFAIL: ${id} ${current} > baseline ${baseline}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

console.log("\nTop files by hit count:");
const byFile = {};
for (const h of allHits) {
  byFile[h.rel] = (byFile[h.rel] ?? 0) + 1;
}
Object.entries(byFile)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([f, c]) => console.log(`  ${c}\t${f}`));
