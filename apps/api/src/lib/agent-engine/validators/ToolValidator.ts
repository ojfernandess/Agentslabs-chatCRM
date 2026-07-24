import type { ToolValidationResult } from "../types.js";

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
};

/**
 * Valida coerência entre ferramentas executadas e resposta enviada.
 */
export function validateToolExecution(input: ToolValidatorInput): ToolValidationResult {
  const alerts: string[] = [];
  let blockSend = false;
  let fallbackSuggested = false;

  const successful = input.toolOutcomes.filter((t) => t.ok);
  const failed = input.toolOutcomes.filter((t) => !t.ok);
  const required = input.requiredToolNames ?? [];

  if (required.length > 0) {
    const invoked = new Set(input.toolOutcomes.map((t) => t.name));
    for (const name of required) {
      if (!invoked.has(name)) {
        alerts.push(`Ferramenta obrigatória não utilizada: ${name}`);
        blockSend = input.strictMode;
      }
    }
  }

  if (failed.length > 0) {
    alerts.push(`Ferramenta retornou erro: ${failed.map((f) => f.name).join(", ")}`);
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
