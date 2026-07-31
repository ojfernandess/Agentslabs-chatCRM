/**
 * Fase 2d — bindings partilhados entre UnifiedSpineSession e buildTurnContext legacy.
 */
import { buildTurnContext } from "../core/buildTurnContext.js";
import type { TurnContext } from "../core/types.js";
import type { AutomationExecutionLogPort } from "../../automationExecutionLog.js";
import {
  requiresLegacyTurnContextBuilder,
  UnifiedSpineSession,
} from "./UnifiedSpineBridge.js";

export type SpineTurnContextBindingsOpts = {
  turnId: string;
  behaviorConfig: Record<string, unknown>;
  userMessage: string;
  availableToolNames: string[];
  toolOutcomes: Array<{
    name: string;
    ok?: boolean;
    preview?: string;
    structuredPayload?: unknown;
  }>;
  toolConfigs: Array<{ name: string; config?: unknown }>;
  memory: Record<string, unknown>;
  sessionPriorOutcomes: Array<{ name: string; ok: boolean }>;
  lastAssistantMessage?: string;
};

export function buildLegacyTurnContextFromBindings(
  opts: SpineTurnContextBindingsOpts,
): TurnContext {
  return buildTurnContext({
    turnId: opts.turnId,
    behaviorConfig: opts.behaviorConfig,
    userMessage: opts.userMessage,
    availableToolNames: opts.availableToolNames,
    toolOutcomes: opts.toolOutcomes,
    toolConfigs: opts.toolConfigs,
    memory: opts.memory,
    sessionPriorOutcomes: opts.sessionPriorOutcomes,
    lastAssistantMessage: opts.lastAssistantMessage,
  });
}

/** Resolve TurnContext via spine — legacy builder omitido em modo `only`. */
export function resolveSpineBoundTurnContext(
  session: UnifiedSpineSession,
  opts: SpineTurnContextBindingsOpts,
  executionLog?: AutomationExecutionLogPort | null,
): TurnContext {
  const legacyBuilder = requiresLegacyTurnContextBuilder(session.mode)
    ? () => buildLegacyTurnContextFromBindings(opts)
    : undefined;
  return session.resolveTurnContext(legacyBuilder, executionLog);
}
