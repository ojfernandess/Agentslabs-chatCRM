/**
 * Fase 7 — Adapters HTTP-only para outcomes de tools (domínio fora do scheduler/reply core).
 */
export {
  httpToolBodyIndicatesFailure,
  extractHttpToolFailureFromWrapper,
} from "./toolOutcomeParsing.js";

import { assembleEmbraturFromSources, normalizeAudaarCheckInPayload } from "./embraturTravelForm.js";
import { canInvokeTool } from "../eil/CapabilityGraph.js";
import type { CapabilityGraph, FactStore } from "../eil/types.js";
import { factsFromFlowSlots, mergeFactStores } from "../eil/FactsEngine.js";
import { listMissingEmbraturFieldKeys, hasCompleteEmbraturFields } from "./embraturReferenceResolver.js";
import {
  buildEmbraturIncompleteToolError,
  isCheckInCompletionToolName,
} from "./embraturRuntimeGuards.js";

/** Montagem payload check-in HTTP — só no invoke path (automationHttpToolExecute). */
export function adaptHttpCheckInPayload(args: Record<string, unknown>): Record<string, unknown> {
  const embratur = assembleEmbraturFromSources(args);
  const merged = embratur && Object.keys(embratur).length > 0 ? { ...args, embratur } : args;
  return normalizeAudaarCheckInPayload(merged);
}

/** Gate pré-invoke via CapabilityGraph — substitui guard runtime directo (P-040/P-045). */
export function checkInPreInvokeBlockReason(
  toolName: string,
  graph: CapabilityGraph | null | undefined,
  facts: FactStore,
  flowSlots: Record<string, unknown> | null | undefined,
): string | null {
  if (!isCheckInCompletionToolName(toolName)) return null;
  const store = mergeFactStores(
    facts,
    factsFromFlowSlots(
      flowSlots as Record<string, string | number | boolean> | undefined,
    ),
  );
  if (graph) {
    const invoke = canInvokeTool(graph, toolName, store);
    if (!invoke.ok) {
      const missing = listMissingEmbraturFieldKeys((flowSlots ?? {}) as Record<string, unknown>);
      return JSON.stringify({
        ok: false,
        validationError: true,
        error: "capability_preconditions_unmet",
        unmetFacts: invoke.unmetFacts,
        missingFields: missing,
        message:
          `Factos em falta para \`${toolName}\`: ${invoke.unmetFacts.join(", ")}. ` +
          "Execute tools produtoras primeiro (ex.: embratur-reference).",
      });
    }
    return null;
  }
  if (!hasCompleteEmbraturFields((flowSlots ?? {}) as Record<string, unknown>)) {
    return buildEmbraturIncompleteToolError(flowSlots ?? {});
  }
  return null;
}
