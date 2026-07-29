import type { AgentEngineConfig } from "../types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import type { TurnContext } from "../core/types.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";

export type ScheduledToolInvocation = {
  toolName: string;
  args: Record<string, unknown>;
  reason: "execution_contract_required";
};

/** Inferência genérica de argumentos a partir de entidades do turno — sem regras de segmento. */
export function buildScheduledToolArgs(toolName: string, turnContext: TurnContext): Record<string, unknown> {
  const normalized = toolName.trim().toLowerCase();
  const msg = turnContext.userMessage.trim();
  const entities = turnContext.intent.entities;

  if (normalized === "buscar_conhecimento") {
    return { query: msg };
  }

  const args: Record<string, unknown> = {};
  const ref =
    (typeof entities.referenceCode === "string" && entities.referenceCode.trim()) ||
    msg.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i)?.[0]?.toUpperCase() ||
    "";

  if (ref) {
    // Aliases comuns em HTTP tools (schema Audaar usa localizadorOuReservationId).
    args.reference = ref;
    args.localizador = ref;
    args.localizadorOuReservationId = ref;
    args.booking_reference = ref;
    args.reservation_code = ref;
    args.reservationId = ref;
    args.codigo = ref;
  }
  if (entities.documentNumber) {
    args.cpf = entities.documentNumber;
    args.document = entities.documentNumber;
    args.documentNumber = entities.documentNumber;
  }

  // HTTP tools: runtime context + auto-fill preenchem o resto quando args vazios.
  if (Object.keys(args).length === 0 && msg) {
    args.user_message = msg;
  }
  return args;
}

/** Planeia invocações determinísticas para tools obrigatórias ainda pendentes. */
export function planScheduledToolInvocations(
  turnContext: TurnContext,
  existingOutcomes: Array<{ name: string; ok?: boolean }> = [],
): ScheduledToolInvocation[] {
  const pending = turnContext.executionContract.pendingToolNames.filter(
    (name) => !toolOutcomeSatisfiesRequired(name, existingOutcomes),
  );
  return pending.map((toolName) => ({
    toolName,
    args: buildScheduledToolArgs(toolName, turnContext),
    reason: "execution_contract_required" as const,
  }));
}

export function shouldRunToolScheduler(
  engineConfig: AgentEngineConfig,
  executionHints?: AgentRuntimeExecuteInput["executionHints"],
): boolean {
  if (engineConfig.schedulerEnabled !== true) return false;
  if (executionHints?.replyOnlyRetry) return false;
  return true;
}

/** Compacta payload para o prompt — evita dumps gigantes; mantém chaves/valores úteis. */
export function compactStructuredPayloadForPrompt(payload: unknown, maxChars = 3500): string {
  if (payload == null) return "";
  try {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}…`;
  } catch {
    return "";
  }
}

export function formatScheduledToolsSystemAppendix(
  outcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>,
): string {
  if (!outcomes.length) return "";
  const lines = outcomes.map((o) => {
    const factsJson =
      o.ok && o.structuredPayload != null
        ? compactStructuredPayloadForPrompt(o.structuredPayload)
        : "";
    const factsBlock = factsJson
      ? `\n  Factos estruturados (OBRIGATÓRIO citar na resposta ao cliente):\n  \`\`\`json\n  ${factsJson}\n  \`\`\``
      : "";
    return `- **${o.name}** (${o.ok ? "ok" : "falhou"}): ${o.preview.slice(0, 1200)}${factsBlock}`;
  });
  return (
    "\n\n## Ferramentas já executadas pelo Runtime (Tool Scheduler)\n" +
    "Não volte a invocar estas ferramentas neste turno.\n" +
    "A resposta AO CLIENTE DEVE usar os factos/dados abaixo de forma substantiva " +
    "(datas, estado, identificadores, valores, nomes). " +
    "Proibido responder só que «encontrou» / «localizou» sem detalhar os dados retornados.\n" +
    lines.join("\n")
  );
}
