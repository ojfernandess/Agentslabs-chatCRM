import type { ToolValidationResult } from "../types.js";
import { toolOutcomeSatisfiesRequired } from "./requiredToolNamesParser.js";
import {
  resolveTurnPolicy,
  toolsMatchAlias,
  validateToolOutcomesAgainstTurnPolicy,
  type TurnPolicy,
} from "./turnPolicyParser.js";
import type { CapabilityGraph, FactStore } from "../eil/types.js";
import { detectToolOrderViolations, capabilityPreExecBlockReason } from "../eil/CapabilityGraph.js";

/**
 * Falhas reais (não skipped) que ainda não foram supersedidas por sucesso
 * da mesma tool no turno (ex.: Scheduler falhou schema → LLM retentou OK).
 */
export function unresolvedToolFailures(
  toolOutcomes: Array<{ name: string; ok: boolean; preview?: string }>,
): Array<{ name: string; ok: boolean; preview?: string }> {
  const successful = toolOutcomes.filter((t) => t.ok);
  return toolOutcomes.filter((f) => {
    if (f.ok) return false;
    if (/"skipped"\s*:\s*true/i.test(f.preview ?? "")) return false;
    const superseded = successful.some(
      (s) => s.name === f.name || toolsMatchAlias(s.name, f.name),
    );
    return !superseded;
  });
}

export type ToolRoundOutcome = {
  name: string;
  ok: boolean;
  preview: string;
  required?: boolean;
};

export type ToolValidatorInput = {
  toolOutcomes: ToolRoundOutcome[];
  replyText: string;
  strictMode: boolean;
  requiredToolNames?: string[];
  /** Política de turno (playbook). Se omitida e behaviorConfig presente, resolve-se. */
  turnPolicy?: TurnPolicy;
  behaviorConfig?: Record<string, unknown>;
  userMessage?: string;
  /** Capability Graph — valida ordem / requiresFacts / conflicts. */
  capabilityGraph?: CapabilityGraph | null;
  /** Factos conhecidos no início do turno (antes das tools deste turno). */
  factsBeforeTurn?: FactStore | null;
};

/**
 * Valida coerência entre ferramentas executadas e resposta enviada.
 * Inclui políticas genéricas do playbook (pares proibidos, exclusividade de turno)
 * e hard-gates do Capability Graph quando fornecidos.
 */
export function validateToolExecution(input: ToolValidatorInput): ToolValidationResult {
  const alerts: string[] = [];
  let blockSend = false;
  let fallbackSuggested = false;

  const successful = input.toolOutcomes.filter((t) => t.ok);
  const required = input.requiredToolNames ?? [];

  if (required.length > 0) {
    for (const name of required) {
      if (!toolOutcomeSatisfiesRequired(name, input.toolOutcomes)) {
        alerts.push(`Ferramenta obrigatória não utilizada: ${name}`);
        blockSend = input.strictMode;
      }
    }
  }

  const policy =
    input.turnPolicy ??
    (input.behaviorConfig
      ? resolveTurnPolicy(input.behaviorConfig, { userMessage: input.userMessage })
      : null);
  if (policy) {
    for (const alert of validateToolOutcomesAgainstTurnPolicy(input.toolOutcomes, policy)) {
      alerts.push(alert);
      blockSend = true;
    }
  }

  if (input.capabilityGraph) {
    const facts = input.factsBeforeTurn ?? {};
    const orderAlerts = detectToolOrderViolations(
      input.capabilityGraph,
      input.toolOutcomes,
      facts,
    );
    for (const a of orderAlerts) {
      alerts.push(a);
      if (input.strictMode) blockSend = true;
    }
    // conflictsWith entre tools bem-sucedidas no turno
    const okNames: string[] = [];
    for (const t of input.toolOutcomes) {
      if (t.ok === false) continue;
      const block = capabilityPreExecBlockReason(
        t.name,
        input.capabilityGraph,
        facts,
        okNames,
      );
      if (block && /conflita/i.test(block)) {
        alerts.push(block);
        blockSend = true;
      }
      okNames.push(t.name);
    }
  }

  const realFailures = unresolvedToolFailures(input.toolOutcomes);
  if (realFailures.length > 0) {
    alerts.push(`Ferramenta retornou erro: ${realFailures.map((f) => f.name).join(", ")}`);
    fallbackSuggested = true;
    if (input.strictMode) blockSend = true;
  }

  if (successful.length > 0 && !input.replyText.trim()) {
    alerts.push("Ferramenta executada mas resposta não enviada ao utilizador");
    blockSend = true;
  }

  const stallPatterns = /^(só um momento|aguarde|vou verificar|um instante)/i;
  if (
    successful.length > 0 &&
    input.replyText.trim() &&
    stallPatterns.test(input.replyText.trim()) &&
    input.strictMode
  ) {
    alerts.push("Resposta de espera após tool com sucesso — possível resultado não entregue");
    blockSend = true;
  }

  return {
    ok: alerts.length === 0,
    blockSend,
    alerts,
    fallbackSuggested,
  };
}
