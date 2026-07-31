/**
 * Fase 7 — Ponte monolito ↔ packer/sandbox (redução LLM + gates genéricos).
 */
import type { TurnContext } from "../core/types.js";
import { packTurnContextForLlm } from "./TurnContextPacker.js";
import {
  evaluateLlmToolSandbox,
  llmToolSandboxBlockMessage,
  type LlmToolSandboxDecision,
} from "./LlmToolSandbox.js";
import { filterToolsForCurrentStep } from "./FilteredToolCatalog.js";
import { checkInPreInvokeBlockReason } from "../checkin/toolOutcomeAdapters.js";
import type { CapabilityGraph, FactStore } from "../eil/types.js";

export function appendPackedLlmContext(systemBase: string, turnContext: TurnContext): string {
  const packed = packTurnContextForLlm(turnContext);
  return (
    systemBase +
    `\n\n[OpenConduit — contexto do passo (sem playbook completo)]\n` +
    packed.systemSlice
  );
}

export function resolveLlmToolCatalog(
  allToolNames: string[],
  turnContext: TurnContext,
): string[] {
  return filterToolsForCurrentStep(allToolNames, turnContext);
}

export function gateLlmToolCall(opts: {
  toolName: string;
  turnContext: TurnContext;
  alreadyCalledThisTurn: string[];
  capabilityGraph?: CapabilityGraph | null;
  sessionFacts?: FactStore;
  flowSlots?: Record<string, unknown> | null;
}): LlmToolSandboxDecision & { blockJson?: string } {
  const sandbox = evaluateLlmToolSandbox(
    opts.toolName,
    opts.turnContext,
    opts.alreadyCalledThisTurn,
  );
  if (!sandbox.allowed) {
    return { ...sandbox, blockJson: llmToolSandboxBlockMessage(sandbox) };
  }

  const preInvoke = checkInPreInvokeBlockReason(
    opts.toolName,
    opts.capabilityGraph,
    opts.sessionFacts ?? opts.turnContext.facts ?? {},
    opts.flowSlots,
  );
  if (preInvoke) {
    return {
      allowed: false,
      reason: "check-in preconditions unmet",
      layer: "policy",
      blockJson: preInvoke,
    };
  }

  return { ...sandbox, allowed: true };
}
