/**
 * Fase 8 — CI / pre-commit architecture gates unificados.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { evaluateProposedChange } from "./governanceService.js";
import { readGitMetadata, readStagedFiles } from "./gitMetadata.js";
import { runArchitectureSimulator } from "./simulator.js";
import { resolveRepoRoot } from "./paths.js";
import type { ProposedChange } from "./types.js";

export type CiGateEntry = {
  id: string;
  passed: boolean;
  message?: string;
  blocking: boolean;
};

export type CiGateResult = {
  passed: boolean;
  gates: CiGateEntry[];
};

export type RunCiGatesOpts = {
  repoRoot?: string;
  modifiedFiles?: string[];
  /** Score mínimo pós-F7 (default 7). */
  minArchitectureScore?: number;
  skipSimulator?: boolean;
  skipPatchScan?: boolean;
  skipPromptPatchCheck?: boolean;
};

function runScript(scriptRel: string, args: string[], repoRoot: string): { ok: boolean; output: string } {
  const script = join(repoRoot, "apps", "api", scriptRel);
  try {
    const output = execSync(`node ${script} ${args.join(" ")}`, {
      cwd: join(repoRoot, "apps", "api"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: [e.stdout, e.stderr, e.message].filter(Boolean).join("\n"),
    };
  }
}

function proposalFromFiles(files: string[], repoRoot: string): ProposedChange {
  const git = readGitMetadata(repoRoot);
  const touchesRuntime = files.some((f) =>
    /agent-engine|agentNativeLlm|automationHttp|architecture-governance/.test(f),
  );
  return {
    title: `CI gate ${git.branch}@${git.commit}`,
    reason: "Architecture CI validation",
    problem: touchesRuntime ? "Runtime change requires governance checks" : "Docs/config change",
    modifiedFiles: files,
    architectureBefore: "main branch baseline",
    architectureAfter: "Proposed PR changes",
    technicalJustification: "ADR-0011 Architecture CI Gates",
    rootCause: touchesRuntime ? "Structural runtime evolution" : undefined,
  };
}

/** Gates completos para pipeline CI. */
export async function runArchitectureCiGates(opts: RunCiGatesOpts = {}): Promise<CiGateResult> {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const files = opts.modifiedFiles ?? [];
  const gates: CiGateEntry[] = [];
  const minScore = opts.minArchitectureScore ?? 7;

  if (files.length > 0) {
    const pkg = evaluateProposedChange(proposalFromFiles(files, repoRoot), repoRoot);
    gates.push({
      id: "impact_analysis",
      passed: pkg.impact.affectedComponents.length >= 0,
      message: `Components: ${pkg.impact.affectedComponents.join(", ") || "none"}`,
      blocking: true,
    });
    gates.push({
      id: "quality_gates",
      passed: pkg.qualityGates.passed,
      message: pkg.qualityGates.violations.map((v) => v.message).join("; ") || "ok",
      blocking: true,
    });
    gates.push({
      id: "architecture_score",
      passed: pkg.architectureScore.total >= minScore,
      message: `Score ${pkg.architectureScore.total}/10 (min ${minScore})`,
      blocking: true,
    });
    gates.push({
      id: "architecture_review",
      passed: pkg.architectureReview.approved,
      message: pkg.architectureReview.blockers?.join("; ") || "approved",
      blocking: true,
    });
  }

  if (!opts.skipPromptPatchCheck && files.length > 0) {
    const checkArgs = files.map((f) => `"${f}"`);
    const patchCheck = runScript("scripts/check-prompt-specific-patches.mjs", checkArgs, repoRoot);
    gates.push({
      id: "no_prompt_specific_patches",
      passed: patchCheck.ok,
      message: patchCheck.ok ? "ok" : patchCheck.output.slice(0, 500),
      blocking: true,
    });
  }

  if (!opts.skipPatchScan) {
    const scan = runScript("scripts/scan-runtime-patches.mjs", ["--fail-on-new"], repoRoot);
    gates.push({
      id: "scan_runtime_patches",
      passed: scan.ok,
      message: scan.ok ? "baseline ok" : scan.output.slice(0, 500),
      blocking: true,
    });
  }

  if (!opts.skipSimulator) {
    const sim = await runArchitectureSimulator();
    gates.push({
      id: "architecture_simulator",
      passed: sim.passed,
      message: sim.results
        .flatMap((r) => (r.passed ? [] : [`${r.scenarioId}: ${r.warnings.join(", ")}`]))
        .join("; ") || "all scenarios ok",
      blocking: true,
    });
  }

  const blocking = gates.filter((g) => g.blocking);
  return {
    passed: blocking.every((g) => g.passed),
    gates,
  };
}

/** Pre-commit — só ficheiros staged + checks rápidos. */
export async function runPreCommitArchitectureGate(repoRoot?: string): Promise<CiGateResult> {
  const root = repoRoot ?? resolveRepoRoot();
  const staged = readStagedFiles(root);
  if (staged.length === 0) {
    return { passed: true, gates: [{ id: "no_staged_files", passed: true, blocking: false }] };
  }

  const runtimeTouched = staged.some((f) =>
    /apps\/api\/src\/lib\/(?:agent-engine|agentNativeLlm|automationHttp)/.test(f.replace(/\\/g, "/")),
  );

  if (!runtimeTouched) {
    return {
      passed: true,
      gates: [{ id: "runtime_untouched", passed: true, message: "skip heavy gates", blocking: false }],
    };
  }

  return runArchitectureCiGates({
    repoRoot: root,
    modifiedFiles: staged.map((f) => f.replace(/\\/g, "/")),
    skipSimulator: true,
    minArchitectureScore: 5,
  });
}
