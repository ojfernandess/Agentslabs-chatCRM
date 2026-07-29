import type { WorkflowCondition, WorkflowDefinition, WorkflowStep, WorkflowStepKind } from "./types.js";

const STEP_KINDS = new Set<WorkflowStepKind>([
  "noop",
  "set_var",
  "tool",
  "branch",
  "loop",
  "suspend",
  "fail",
]);

function asCondition(raw: unknown): WorkflowCondition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const cond: WorkflowCondition = {};
  if (typeof o.var === "string") cond.var = o.var;
  if ("eq" in o) cond.eq = o.eq;
  if (typeof o.truthy === "boolean") cond.truthy = o.truthy;
  if (o.not === true) cond.not = true;
  if (!cond.var && cond.truthy === undefined && !("eq" in cond)) return undefined;
  return cond;
}

function asStep(id: string, raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? (o.kind as WorkflowStepKind) : null;
  if (!kind || !STEP_KINDS.has(kind)) return null;
  const step: WorkflowStep = { id, kind };
  if (typeof o.next === "string") step.next = o.next;
  if (o.next === null) step.next = null;
  if (typeof o.varName === "string") step.varName = o.varName;
  if ("varValue" in o) step.varValue = o.varValue;
  if (typeof o.toolName === "string") step.toolName = o.toolName;
  if (o.toolArgs && typeof o.toolArgs === "object" && !Array.isArray(o.toolArgs)) {
    step.toolArgs = o.toolArgs as Record<string, unknown>;
  }
  const when = asCondition(o.when);
  if (when) step.when = when;
  if (typeof o.then === "string") step.then = o.then;
  if (typeof o.else === "string") step.else = o.else;
  if (typeof o.body === "string") step.body = o.body;
  const until = asCondition(o.until);
  if (until) step.until = until;
  if (typeof o.maxIterations === "number" && o.maxIterations > 0) {
    step.maxIterations = Math.min(Math.floor(o.maxIterations), 100);
  }
  if (typeof o.suspendReason === "string") step.suspendReason = o.suspendReason;
  if (o.resumeOn === "hitl" || o.resumeOn === "next_message" || o.resumeOn === "manual") {
    step.resumeOn = o.resumeOn;
  }
  if (typeof o.failMessage === "string") step.failMessage = o.failMessage;
  if (typeof o.compensateWith === "string") step.compensateWith = o.compensateWith;
  return step;
}

/**
 * Lê `behaviorConfig.agentEngine.workflow` ou um objecto WorkflowDefinition cru.
 */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : null;
  const entry = typeof o.entry === "string" && o.entry.trim() ? o.entry.trim() : null;
  if (!id || !entry) return null;
  const stepsRaw = o.steps;
  if (!stepsRaw || typeof stepsRaw !== "object" || Array.isArray(stepsRaw)) return null;
  const steps: Record<string, WorkflowStep> = {};
  for (const [stepId, stepVal] of Object.entries(stepsRaw as Record<string, unknown>)) {
    const step = asStep(stepId, stepVal);
    if (step) steps[stepId] = step;
  }
  if (!steps[entry]) return null;
  return {
    version: 1,
    id,
    entry,
    steps,
    label: typeof o.label === "string" ? o.label : undefined,
  };
}

/** Extrai definição de `behaviorConfig.agentEngine.workflow`. */
export function parseWorkflowFromBehavior(behaviorConfig: unknown): WorkflowDefinition | null {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return null;
  const ae = (behaviorConfig as Record<string, unknown>).agentEngine;
  if (!ae || typeof ae !== "object") return null;
  return parseWorkflowDefinition((ae as Record<string, unknown>).workflow);
}

export function getVarPath(vars: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return vars[path];
  const parts = path.split(".");
  let cur: unknown = vars;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function evaluateCondition(
  cond: WorkflowCondition | undefined,
  vars: Record<string, unknown>,
): boolean {
  if (!cond) return true;
  let ok = true;
  if (cond.var) {
    const v = getVarPath(vars, cond.var);
    if (cond.truthy === true) {
      ok = Boolean(v);
    } else if (cond.truthy === false) {
      ok = !v;
    } else if ("eq" in cond) {
      ok = v === cond.eq;
    } else {
      ok = v !== undefined && v !== null;
    }
  } else if (cond.truthy === true) {
    ok = true;
  }
  return cond.not ? !ok : ok;
}
