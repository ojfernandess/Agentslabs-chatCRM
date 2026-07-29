import { randomUUID } from "node:crypto";
import { evaluateCondition } from "./parseWorkflowDefinition.js";
import { saveWorkflowRun } from "./WorkflowStore.js";
import type {
  WorkflowAdvanceResult,
  WorkflowDefinition,
  WorkflowRunState,
  WorkflowStep,
  WorkflowStepHandlers,
} from "./types.js";

const MAX_STEPS_PER_ADVANCE = 64;

export type StartWorkflowOpts = {
  definition: WorkflowDefinition;
  vars?: Record<string, unknown>;
  organizationId?: string;
  conversationId?: string;
  runId?: string;
  handlers?: WorkflowStepHandlers;
  /** Persist after each terminal transition. Default true. */
  persist?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function touch(state: WorkflowRunState): WorkflowRunState {
  return { ...state, updatedAt: nowIso() };
}

function markCompleted(state: WorkflowRunState, stepId: string): WorkflowRunState {
  if (state.completedStepIds.includes(stepId)) return state;
  return {
    ...state,
    completedStepIds: [...state.completedStepIds, stepId],
  };
}

function pushCompensation(state: WorkflowRunState, step: WorkflowStep): WorkflowRunState {
  if (!step.compensateWith) return state;
  return {
    ...state,
    compensationStack: [...state.compensationStack, step.compensateWith],
  };
}

function createInitialState(opts: StartWorkflowOpts): WorkflowRunState {
  const createdAt = nowIso();
  return {
    version: 1,
    workflowId: opts.definition.id,
    runId: opts.runId ?? randomUUID(),
    organizationId: opts.organizationId,
    conversationId: opts.conversationId,
    status: "running",
    currentStepId: opts.definition.entry,
    completedStepIds: [],
    compensationStack: [],
    iterationCounts: {},
    vars: { ...(opts.vars ?? {}) },
    plannedToolNames: [],
    toolResults: [],
    createdAt,
    updatedAt: createdAt,
  };
}

async function maybePersist(state: WorkflowRunState, persist: boolean): Promise<void> {
  if (!persist) return;
  await saveWorkflowRun(state);
}

/**
 * Executa um step e devolve o estado + próximo step id (ou null se terminal).
 */
async function executeOneStep(
  def: WorkflowDefinition,
  state: WorkflowRunState,
  step: WorkflowStep,
  handlers?: WorkflowStepHandlers,
): Promise<{ state: WorkflowRunState; nextId: string | null; stop: boolean }> {
  switch (step.kind) {
    case "noop": {
      let next = markCompleted(state, step.id);
      next = pushCompensation(next, step);
      return { state: touch(next), nextId: step.next ?? null, stop: false };
    }
    case "set_var": {
      if (!step.varName) {
        return {
          state: touch({ ...state, status: "failed", error: `set_var missing varName @${step.id}`, currentStepId: step.id }),
          nextId: null,
          stop: true,
        };
      }
      let next: WorkflowRunState = {
        ...state,
        vars: { ...state.vars, [step.varName]: step.varValue },
      };
      next = markCompleted(next, step.id);
      next = pushCompensation(next, step);
      return { state: touch(next), nextId: step.next ?? null, stop: false };
    }
    case "tool": {
      const toolName = step.toolName;
      if (!toolName) {
        return {
          state: touch({
            ...state,
            status: "failed",
            error: `tool step missing toolName @${step.id}`,
            currentStepId: step.id,
          }),
          nextId: null,
          stop: true,
        };
      }
      let next: WorkflowRunState = {
        ...state,
        plannedToolNames: state.plannedToolNames.includes(toolName)
          ? state.plannedToolNames
          : [...state.plannedToolNames, toolName],
      };
      if (handlers?.onTool) {
        const result = await handlers.onTool(step, next);
        next = {
          ...next,
          toolResults: [...next.toolResults, { name: toolName, ...result }],
          vars: {
            ...next.vars,
            [`tool.${toolName}.ok`]: result.ok,
            [`tool.${toolName}.result`]: result.result,
          },
        };
        if (!result.ok) {
          return {
            state: touch({
              ...next,
              status: "failed",
              error: result.error ?? `tool_failed:${toolName}`,
              currentStepId: step.id,
            }),
            nextId: null,
            stop: true,
          };
        }
      }
      next = markCompleted(next, step.id);
      next = pushCompensation(next, step);
      return { state: touch(next), nextId: step.next ?? null, stop: false };
    }
    case "branch": {
      const takeThen = evaluateCondition(step.when, state.vars);
      const target = takeThen ? step.then : step.else;
      let next = markCompleted(state, step.id);
      next = pushCompensation(next, step);
      if (!target) {
        return { state: touch({ ...next, status: "completed", currentStepId: null }), nextId: null, stop: true };
      }
      return { state: touch(next), nextId: target, stop: false };
    }
    case "loop": {
      const max = step.maxIterations ?? 8;
      const count = state.iterationCounts[step.id] ?? 0;
      const done = evaluateCondition(step.until, state.vars) || count >= max;
      if (done) {
        let next = markCompleted(state, step.id);
        next = pushCompensation(next, step);
        return { state: touch(next), nextId: step.next ?? null, stop: false };
      }
      if (!step.body || !def.steps[step.body]) {
        return {
          state: touch({
            ...state,
            status: "failed",
            error: `loop missing body @${step.id}`,
            currentStepId: step.id,
          }),
          nextId: null,
          stop: true,
        };
      }
      const next: WorkflowRunState = {
        ...state,
        iterationCounts: { ...state.iterationCounts, [step.id]: count + 1 },
      };
      // Após body, volta ao loop step (reavalia until).
      const bodyStep = def.steps[step.body];
      const bodyWithReturn: WorkflowStep = {
        ...bodyStep,
        next: step.id,
      };
      // Executa body inline uma vez via recursão controlada no advance.
      void bodyWithReturn;
      return { state: touch(next), nextId: step.body, stop: false };
    }
    case "suspend": {
      return {
        state: touch({
          ...state,
          status: "suspended",
          currentStepId: step.id,
          suspendReason: step.suspendReason ?? "awaiting_input",
          resumeOn: step.resumeOn ?? "manual",
        }),
        nextId: null,
        stop: true,
      };
    }
    case "fail": {
      return {
        state: touch({
          ...state,
          status: "failed",
          error: step.failMessage ?? `fail_step:${step.id}`,
          currentStepId: step.id,
        }),
        nextId: null,
        stop: true,
      };
    }
    default: {
      return {
        state: touch({
          ...state,
          status: "failed",
          error: `unknown_step_kind:${(step as WorkflowStep).kind}`,
          currentStepId: step.id,
        }),
        nextId: null,
        stop: true,
      };
    }
  }
}

/**
 * Avança o workflow até suspend / complete / fail / max steps.
 * Loop: após body, o body deve ter `next` apontando de volta ao loop,
 * OU o engine reescreve temporariamente — aqui forçamos retorno ao loop
 * quando o step actual é body de algum loop activo.
 */
export async function advanceWorkflow(
  def: WorkflowDefinition,
  state: WorkflowRunState,
  handlers?: WorkflowStepHandlers,
  persist = true,
): Promise<WorkflowAdvanceResult> {
  let cur: WorkflowRunState = {
    ...state,
    status: state.status === "suspended" ? "running" : state.status,
  };
  if (cur.status !== "running" && cur.status !== "compensating") {
    return { state: cur, done: true };
  }

  let steps = 0;
  while (steps < MAX_STEPS_PER_ADVANCE) {
    steps += 1;
    if (!cur.currentStepId) {
      cur = touch({ ...cur, status: "completed" });
      await maybePersist(cur, persist);
      return { state: cur, done: true };
    }
    const step = def.steps[cur.currentStepId];
    if (!step) {
      cur = touch({
        ...cur,
        status: "failed",
        error: `unknown_step:${cur.currentStepId}`,
      });
      await maybePersist(cur, persist);
      return { state: cur, done: true };
    }

    // Loop body: se este step é body de um loop e não tem next, volta ao loop.
    let effectiveStep = step;
    if (!step.next) {
      for (const [loopId, loopStep] of Object.entries(def.steps)) {
        if (loopStep.kind === "loop" && loopStep.body === step.id) {
          effectiveStep = { ...step, next: loopId };
          break;
        }
      }
    }

    const result = await executeOneStep(def, cur, effectiveStep, handlers);
    cur = result.state;
    if (result.stop) {
      if (cur.status === "failed" && cur.compensationStack.length > 0) {
        const compensated = await runCompensation(def, cur, handlers, persist);
        return { state: compensated, done: true };
      }
      await maybePersist(cur, persist);
      return { state: cur, done: true };
    }
    cur = touch({ ...cur, currentStepId: result.nextId });
    if (!result.nextId) {
      cur = touch({ ...cur, status: "completed", currentStepId: null });
      await maybePersist(cur, persist);
      return { state: cur, done: true };
    }
  }

  cur = touch({
    ...cur,
    status: "failed",
    error: "max_steps_exceeded",
  });
  await maybePersist(cur, persist);
  return { state: cur, done: true };
}

async function runCompensation(
  def: WorkflowDefinition,
  state: WorkflowRunState,
  handlers?: WorkflowStepHandlers,
  persist = true,
): Promise<WorkflowRunState> {
  const originalError = state.error;
  let cur: WorkflowRunState = touch({
    ...state,
    status: "compensating",
  });
  const stack = [...cur.compensationStack].reverse();
  for (const stepId of stack) {
    const step = def.steps[stepId];
    if (!step) continue;
    const result = await executeOneStep(def, cur, { ...step, compensateWith: undefined }, handlers);
    cur = result.state;
    if (cur.status === "failed" && cur.error && cur.error !== originalError) {
      break;
    }
    cur = touch({
      ...cur,
      status: "compensating",
      error: originalError,
      compensationStack: cur.compensationStack.filter((id) => id !== stepId),
    });
  }
  cur = touch({
    ...cur,
    status: "compensated",
    currentStepId: null,
    compensationStack: [],
    error: originalError,
  });
  await maybePersist(cur, persist);
  return cur;
}

/** Inicia e avança até terminal ou suspend. */
export async function startWorkflow(opts: StartWorkflowOpts): Promise<WorkflowAdvanceResult> {
  const persist = opts.persist !== false;
  const initial = createInitialState(opts);
  await maybePersist(initial, persist);
  return advanceWorkflow(opts.definition, initial, opts.handlers, persist);
}

/** Resume após suspend — aplica vars e continua no `next` do step de suspend. */
export async function resumeWorkflow(
  def: WorkflowDefinition,
  state: WorkflowRunState,
  opts: {
    vars?: Record<string, unknown>;
    handlers?: WorkflowStepHandlers;
    persist?: boolean;
  } = {},
): Promise<WorkflowAdvanceResult> {
  if (state.status !== "suspended") {
    return { state, done: state.status !== "running" };
  }
  const suspendStep = state.currentStepId ? def.steps[state.currentStepId] : null;
  const nextId = suspendStep?.next ?? null;
  let cur: WorkflowRunState = touch({
    ...state,
    status: "running",
    vars: { ...state.vars, ...(opts.vars ?? {}) },
    suspendReason: undefined,
    completedStepIds: suspendStep
      ? state.completedStepIds.includes(suspendStep.id)
        ? state.completedStepIds
        : [...state.completedStepIds, suspendStep.id]
      : state.completedStepIds,
    currentStepId: nextId,
  });
  if (suspendStep) {
    cur = {
      ...cur,
      compensationStack: suspendStep.compensateWith
        ? [...cur.compensationStack, suspendStep.compensateWith]
        : cur.compensationStack,
    };
  }
  if (!nextId) {
    cur = touch({ ...cur, status: "completed", currentStepId: null });
    await maybePersist(cur, opts.persist !== false);
    return { state: cur, done: true };
  }
  return advanceWorkflow(def, cur, opts.handlers, opts.persist !== false);
}

/** Força compensação manual (ex.: cancelamento HITL). */
export async function compensateWorkflow(
  def: WorkflowDefinition,
  state: WorkflowRunState,
  handlers?: WorkflowStepHandlers,
  persist = true,
): Promise<WorkflowRunState> {
  if (state.compensationStack.length === 0) {
    const done = touch({ ...state, status: "compensated", currentStepId: null });
    await maybePersist(done, persist);
    return done;
  }
  return runCompensation(def, { ...state, status: "failed", error: state.error ?? "manual_compensate" }, handlers, persist);
}
