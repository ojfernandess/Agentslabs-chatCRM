import type { AgentEngineConfig } from "../types.js";
import type { WorkflowDefinition, WorkflowRunState } from "./types.js";
import { parseWorkflowFromBehavior } from "./parseWorkflowDefinition.js";
import {
  loadActiveWorkflowForConversation,
  saveWorkflowRun,
} from "./WorkflowStore.js";
import { resumeWorkflow, startWorkflow } from "./WorkflowEngine.js";

export type RunContinuationOpts = {
  engineConfig: AgentEngineConfig;
  behaviorConfig: Record<string, unknown>;
  organizationId: string;
  conversationId: string;
  /** Vars iniciais (facts/slots/message). */
  vars?: Record<string, unknown>;
  /** Mensagem actual — injectada em vars.userMessage no resume. */
  userMessage?: string;
};

export type RunContinuationResult = {
  enabled: boolean;
  definition: WorkflowDefinition | null;
  state: WorkflowRunState | null;
  resumed: boolean;
};

/**
 * Corre ou retoma o Workflow/Step Engine quando `workflowEngineEnabled`
 * e existe `agentEngine.workflow` no behavior.
 * Tool steps sem handler só planeiam nomes (Scheduler/LLM continuam a invocar).
 */
export async function runContinuationIfEnabled(
  opts: RunContinuationOpts,
): Promise<RunContinuationResult> {
  if (!opts.engineConfig.workflowEngineEnabled) {
    return { enabled: false, definition: null, state: null, resumed: false };
  }
  const definition = parseWorkflowFromBehavior(opts.behaviorConfig);
  if (!definition) {
    return { enabled: true, definition: null, state: null, resumed: false };
  }

  const existing = await loadActiveWorkflowForConversation(
    opts.organizationId,
    opts.conversationId,
  );

  const baseVars: Record<string, unknown> = {
    ...(opts.vars ?? {}),
    ...(opts.userMessage != null ? { userMessage: opts.userMessage } : {}),
  };

  if (existing && existing.status === "suspended" && existing.workflowId === definition.id) {
    const { state } = await resumeWorkflow(definition, existing, {
      vars: baseVars,
      persist: true,
    });
    return { enabled: true, definition, state, resumed: true };
  }

  const { state } = await startWorkflow({
    definition,
    vars: baseVars,
    organizationId: opts.organizationId,
    conversationId: opts.conversationId,
    persist: true,
  });
  return { enabled: true, definition, state, resumed: false };
}

export function workflowSnapshotSlice(
  state: WorkflowRunState | null | undefined,
):
  | {
      runId: string;
      workflowId: string;
      status: WorkflowRunState["status"];
      currentStepId: string | null;
      plannedToolNames: string[];
      suspendReason?: string;
    }
  | undefined {
  if (!state) return undefined;
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    status: state.status,
    currentStepId: state.currentStepId,
    plannedToolNames: state.plannedToolNames,
    suspendReason: state.suspendReason,
  };
}

export { saveWorkflowRun };
