/**
 * Fase 6 — Empacota contexto mínimo para o LLM (sem playbook completo).
 */
import type { TurnContext } from "../core/types.js";
import { factValuesMap } from "../eil/FactsEngine.js";
import { resolveActiveFlowStep } from "../planner/PlanGraphBuilder.js";
import { filterToolsForCurrentStep } from "./FilteredToolCatalog.js";

export type PackedLlmTurnContext = {
  stepObjective: string;
  factsSummary: string;
  allowedToolNames: string[];
  systemSlice: string;
  estimatedTokenReduction: "high" | "medium" | "low";
};

const MAX_FACTS_CHARS = 1200;

function summarizeFacts(turnContext: TurnContext): string {
  const raw = turnContext.facts ? factValuesMap(turnContext.facts) : {};
  const entries = Object.entries(raw).filter(
    ([k]) => !k.startsWith("__") && raw[k] != null && String(raw[k]).trim() !== "",
  );
  if (entries.length === 0) return "(sem factos de sessão)";
  const lines = entries.slice(0, 24).map(([k, v]) => `- ${k}: ${String(v).slice(0, 80)}`);
  const text = lines.join("\n");
  return text.length > MAX_FACTS_CHARS ? `${text.slice(0, MAX_FACTS_CHARS)}…` : text;
}

export function packTurnContextForLlm(turnContext: TurnContext): PackedLlmTurnContext {
  const flowStep = resolveActiveFlowStep(
    turnContext.promptIr.flows,
    turnContext.executionContract.satisfiedToolNames,
  );
  const stepObjective = (
    flowStep?.label ??
    turnContext.executionContract.objective ??
    turnContext.promptContract.objective
  ).slice(0, 400);
  const factsSummary = summarizeFacts(turnContext);
  const allowedToolNames = filterToolsForCurrentStep(
    turnContext.availableToolNames ?? [],
    turnContext,
  );
  const pending = turnContext.executionContract.pendingToolNames;
  const systemSlice = [
    "## Objetivo do passo actual",
    stepObjective,
    "",
    "## Factos conhecidos",
    factsSummary,
    "",
    pending.length > 0 ? `## Tools pendentes: ${pending.join(", ")}` : "## Tools pendentes: (nenhuma)",
    "",
    "## Ferramentas neste passo",
    allowedToolNames.join(", ") || "(nenhuma)",
    "",
    "Não seleccione tools fora desta lista.",
  ].join("\n");

  const playbookChars = turnContext.promptIr.metadata.playbookCharCount ?? 0;
  const reduction =
    playbookChars > 4000 && systemSlice.length < playbookChars * 0.4
      ? "high"
      : playbookChars > 1500
        ? "medium"
        : "low";

  return { stepObjective, factsSummary, allowedToolNames, systemSlice, estimatedTokenReduction: reduction };
}
