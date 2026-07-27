import type { ToolValidationResult } from "../types.js";
import { toolOutcomeSatisfiesRequired } from "./requiredToolNamesParser.js";
import {
  resolveTurnPolicy,
  validateToolOutcomesAgainstTurnPolicy,
  type TurnPolicy,
} from "./turnPolicyParser.js";

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
};

/**
 * Valida coerência entre ferramentas executadas e resposta enviada.
 * Inclui políticas genéricas do playbook (pares proibidos, exclusividade de turno).
 */
export function validateToolExecution(input: ToolValidatorInput): ToolValidationResult {
  const alerts: string[] = [];
  let blockSend = false;
  let fallbackSuggested = false;

  const successful = input.toolOutcomes.filter((t) => t.ok);
  const failed = input.toolOutcomes.filter((t) => !t.ok);
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

  if (failed.length > 0) {
    const realFailures = failed.filter((f) => !/"skipped"\s*:\s*true/i.test(f.preview));
    if (realFailures.length > 0) {
      alerts.push(`Ferramenta retornou erro: ${realFailures.map((f) => f.name).join(", ")}`);
      fallbackSuggested = true;
      if (input.strictMode) blockSend = true;
    }
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
