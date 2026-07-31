/**
 * Fase 6 — Sandbox: LLM só invoca tools dentro do plano/contrato.
 */
import type { TurnContext } from "../core/types.js";
import { filterToolsForCurrentStep } from "./FilteredToolCatalog.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";

export type LlmToolSandboxDecision = {
  allowed: boolean;
  reason?: string;
  layer: "planner" | "policy" | "runtime";
};

function norm(name: string): string {
  return name.trim().toLowerCase();
}

export function evaluateLlmToolSandbox(
  toolName: string,
  turnContext: TurnContext,
  alreadyCalledThisTurn: string[] = [],
): LlmToolSandboxDecision {
  const name = toolName.trim();
  if (!name) return { allowed: false, reason: "tool name empty", layer: "runtime" };

  if (turnContext.executionContract.forbiddenToolNames.some((f) => norm(f) === norm(name))) {
    return { allowed: false, reason: `Tool \`${name}\` proibida pelo contrato`, layer: "policy" };
  }

  const filtered = filterToolsForCurrentStep(turnContext.availableToolNames ?? [], turnContext);
  if (
    filtered.length > 0 &&
    !filtered.some((t) => norm(t) === norm(name)) &&
    !turnContext.executionContract.pendingToolNames.some((p) => norm(p) === norm(name))
  ) {
    return { allowed: false, reason: `Tool \`${name}\` fora do passo actual`, layer: "planner" };
  }

  if (alreadyCalledThisTurn.some((t) => toolOutcomeSatisfiesRequired(name, [{ name: t, ok: true }]))) {
    return { allowed: false, reason: `Tool \`${name}\` já executada neste turno`, layer: "runtime" };
  }

  return { allowed: true };
}

export function llmToolSandboxBlockMessage(decision: LlmToolSandboxDecision): string {
  return JSON.stringify({
    ok: false,
    error: "llm_tool_sandbox_blocked",
    reason: decision.reason,
    layer: decision.layer,
  });
}
