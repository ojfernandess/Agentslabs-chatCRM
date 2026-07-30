import type { WorkflowDefinition, WorkflowRunState } from "./types.js";

export const IMPLICIT_TURN_WORKFLOW_ID = "implicit-turn-v1";

export const SESSION_WORKFLOW_PHASE_KEY = "__workflowPhase";

/**
 * Workflow implícito por turno — o criador não precisa definir steps.
 * Expõe plannedToolNames ao Contract/Scheduler e fase auditável na MCP.
 */
export function buildImplicitTurnWorkflowDefinition(
  requiredToolNames: string[],
): WorkflowDefinition {
  const required = [...new Set(requiredToolNames.map((n) => n.trim()).filter(Boolean))];
  const steps: WorkflowDefinition["steps"] = {
    intent: { id: "intent", kind: "noop", next: "schedule_required" },
    schedule_required: {
      id: "schedule_required",
      kind: "noop",
      next: required.length > 0 ? "tool_0" : "facts",
    },
    facts: { id: "facts", kind: "noop", next: "reply" },
    reply: { id: "reply", kind: "noop", next: "end" },
    end: { id: "end", kind: "noop", next: null },
  };

  for (let i = 0; i < required.length; i++) {
    const toolName = required[i]!;
    const id = `tool_${i}`;
    const next = i + 1 < required.length ? `tool_${i + 1}` : "facts";
    steps[id] = {
      id,
      kind: "tool",
      toolName,
      next,
    };
  }

  return {
    version: 1,
    id: IMPLICIT_TURN_WORKFLOW_ID,
    entry: "intent",
    label: "Implicit turn workflow",
    steps,
  };
}

export function materializeImplicitWorkflowRun(opts: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  requiredToolNames: string[];
  userMessage: string;
}): { definition: WorkflowDefinition; state: WorkflowRunState } {
  const required = [...new Set(opts.requiredToolNames.map((n) => n.trim()).filter(Boolean))];
  const definition = buildImplicitTurnWorkflowDefinition(required);
  const state: WorkflowRunState = {
    version: 1,
    workflowId: definition.id,
    runId: `${opts.conversationId}:${opts.messageId}:implicit`,
    organizationId: opts.organizationId,
    conversationId: opts.conversationId,
    status: "running",
    currentStepId: required.length > 0 ? "schedule_required" : "reply",
    completedStepIds: ["intent"],
    plannedToolNames: required,
    toolResults: [],
    vars: {
      userMessage: opts.userMessage,
      implicit: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    compensationStack: [],
    iterationCounts: {},
  };
  return { definition, state };
}

export function advanceImplicitWorkflowPhase(
  state: WorkflowRunState,
  phase: "schedule_required" | "facts" | "reply" | "end",
): WorkflowRunState {
  return {
    ...state,
    currentStepId: phase,
    status: phase === "end" ? "completed" : "running",
    updatedAt: new Date().toISOString(),
  };
}
