import {
  buildExecutionTurnPlan,
  type ExecutionTurnPlan,
} from "../planner/ExecutionTurnPlan.js";
import {
  toolOutcomeSatisfiesRequired,
} from "../validators/requiredToolNamesParser.js";
import {
  findForbiddenPairViolation,
  isEscalationToolName,
  isLikelyMutableOrCompletionTool,
  shouldUseReplyOnlyRetry,
  turnPolicyPreExecBlockReasonForTurn,
  type TurnPolicy,
} from "../validators/turnPolicyParser.js";
import type { AgentRuntimeExecuteInput } from "../types.js";

export type TurnExecutionContext = {
  turnPlan: ExecutionTurnPlan;
};

export type ToolOutcomeLite = { name: string; ok: boolean; preview?: string };

export type ResolveTurnExecutionContextOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
  /** Plano já calculado pelo runtime — evita re-parse divergente. */
  existingTurnPlan?: ExecutionTurnPlan;
};

/** Resolve o plano de turno uma vez por execução (fonte única de verdade). */
export function resolveTurnExecutionContext(
  opts: ResolveTurnExecutionContextOpts,
): TurnExecutionContext {
  const turnPlan =
    opts.existingTurnPlan ??
    buildExecutionTurnPlan({
      behaviorConfig: opts.behaviorConfig,
      userMessage: opts.userMessage,
      availableToolNames: opts.availableToolNames,
    });
  return { turnPlan };
}

/** Ferramentas obrigatórias ainda não satisfeitas neste turno. */
export function pendingRequiredToolNames(
  turnPlan: ExecutionTurnPlan,
  toolOutcomes: ToolOutcomeLite[],
): string[] {
  return turnPlan.requiredToolNames.filter((name) => {
    const hit = toolOutcomes.find(
      (t) =>
        t.ok !== false &&
        toolOutcomeSatisfiesRequired(name, [{ name: t.name, preview: t.preview ?? "" }]),
    );
    return !hit;
  });
}

/**
 * Bloqueio pre-exec unificado — delega ao parser de política de turno.
 * Usado por qualquer executor (native LLM, MCP, workflow).
 */
export function assertToolAllowedBeforeExec(input: {
  toolName: string;
  existingToolNames: string[];
  turnPlan: ExecutionTurnPlan;
}): string | null {
  return turnPolicyPreExecBlockReasonForTurn(
    input.toolName,
    input.existingToolNames,
    input.turnPlan.turnPolicy,
    input.turnPlan.requiredToolNames,
  );
}

/**
 * Fallback plain-chat (sem tools) só é seguro quando não há ferramentas obrigatórias pendentes.
 * Evita respostas inventadas em turnos operacionais (ex.: check-in sem consultar_reserva).
 */
export function shouldAllowPlainChatFallback(input: {
  turnPlan: ExecutionTurnPlan;
  toolsAlreadyRun: ToolOutcomeLite[];
}): boolean {
  return pendingRequiredToolNames(input.turnPlan, input.toolsAlreadyRun).length === 0;
}

const MISSING_REQUIRED_ALERT_RE =
  /ferramenta\s+obrigat[oó]ri[a]?\s+n[aã]o\s+utilizada|required\s+tool|tool.*missing|obrigat[oó]ri[a]?\s+n[aã]o\s+(?:foi\s+)?(?:usada|utilizada|executada)/i;

/** Par proibido onde pelo menos uma tool já teve efeito colateral (escalação / mutação). */
function forbiddenPairHasSideEffect(
  okToolNames: string[],
  turnPolicy: TurnPolicy,
): boolean {
  const hit = findForbiddenPairViolation(okToolNames, turnPolicy.forbiddenSameTurnPairs);
  if (!hit) return false;
  return okToolNames.some(
    (n) =>
      isEscalationToolName(n) ||
      isLikelyMutableOrCompletionTool(n, turnPolicy.completionToolHints),
  );
}

/**
 * Decide retry reply-only vs retry completo com ferramentas.
 * Genérico — qualquer agente, workflow ou segmento.
 */
export function shouldUseReplyOnlyRetryForTurn(opts: {
  turnPlan: ExecutionTurnPlan;
  toolOutcomes: ToolOutcomeLite[];
  supervisorChecks?: Array<{ id: string; passed: boolean }>;
  validationAlerts?: string[];
}): boolean {
  const okOutcomes = opts.toolOutcomes.filter((t) => t.ok);
  if (okOutcomes.length === 0) return false;

  const pending = pendingRequiredToolNames(opts.turnPlan, opts.toolOutcomes);
  if (pending.length > 0) return false;

  const alerts = opts.validationAlerts ?? [];
  if (alerts.some((a) => MISSING_REQUIRED_ALERT_RE.test(a))) return false;

  const okNames = okOutcomes.map((t) => t.name);
  const pairHit = findForbiddenPairViolation(okNames, opts.turnPlan.turnPolicy.forbiddenSameTurnPairs);
  if (pairHit && !forbiddenPairHasSideEffect(okNames, opts.turnPlan.turnPolicy)) {
    // Par ilegal sem side-effect (ex.: KB + consulta) → retry completo para corrigir seleção de tools
    return false;
  }

  return shouldUseReplyOnlyRetry({
    toolOutcomes: opts.toolOutcomes,
    supervisorChecks: opts.supervisorChecks,
  });
}

/** Compacta previews de tools OK para grounding do retry reply-only (genérico). */
export function formatPriorToolFactsForReplyOnly(
  prior: Array<{ name: string; ok: boolean; preview: string }> | undefined,
  maxChars = 3500,
): string {
  const ok = (prior ?? []).filter((t) => t.ok && t.preview.trim());
  if (ok.length === 0) return "";
  const blocks: string[] = [];
  let used = 0;
  for (const t of ok) {
    const preview = t.preview.trim().slice(0, 1200);
    const block = `### ${t.name}\n${preview}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

/** Prompt genérico para retry reply-only — derivado do turnPlan, não hardcoded por segmento. */
export function buildGenericReplyOnlyRetryPromptBlock(opts: {
  turnPlan: ExecutionTurnPlan;
  userMessage: string;
  priorSuccessfulToolOutcomes?: Array<{ name: string; ok: boolean; preview: string }>;
}): string {
  const { turnPlan, userMessage } = opts;
  const msg = userMessage.trim();
  const lines = [
    "\n\n[OpenConduit — retry reply-only]",
    "O Supervisor pediu regenerar **apenas a resposta** — **PROIBIDO** invocar ferramentas neste retry.",
    "- Use **somente** factos das ferramentas já executadas neste turno (bloco abaixo, se existir).",
    "- **PROIBIDO** inventar campos ausentes no JSON das tools (RG, profissão, endereço, etc.).",
    "- **PROIBIDO** escrever o literal `undefined`/`null` — omita o campo se não existir no resultado.",
    "- **PROIBIDO** reutilizar flowSlots/memória para preencher campos que a tool não devolveu.",
  ];

  if (turnPlan.turnPolicy.blockEscalation) {
    lines.push(
      "- **PROIBIDO** escalonamento neste turno (transfer, call_human, status, equipas).",
    );
  }
  if (turnPlan.turnPolicy.exclusiveAllowedTools?.length) {
    lines.push(
      `- Turno exclusivo: avance conforme o playbook com o contexto já obtido (${turnPlan.turnPolicy.exclusiveAllowedTools.join(", ")}).`,
    );
  }
  if (turnPlan.requiredToolNames.length > 0) {
    lines.push(
      `- Ferramentas obrigatórias deste turno (já executadas ou presentes no contexto): ${turnPlan.requiredToolNames.join(", ")}.`,
    );
  }
  if (turnPlan.matchedPatternIds.includes("checkin_or_reservation")) {
    lines.push(
      "- Turno operacional de reserva/check-in: responda com base nos dados já consultados; não reinicie o fluxo.",
    );
  }
  if (turnPlan.matchedPatternIds.includes("document_id")) {
    lines.push(
      "- Turno de identificação: use dados já validados; não volte a pedir o mesmo documento.",
    );
  }
  if (/^(sim|ok|okay|certo|confirmo|confirma|yes|yep|não|nao|no)$/i.test(msg)) {
    lines.push(
      "- Confirmação detectada: avance para o **próximo passo** do playbook sem repetir perguntas já feitas.",
    );
    lines.push("- Leia a **última mensagem SUA** no histórico para saber o que foi confirmado.");
  }
  if (turnPlan.turnPolicy.forbiddenSameTurnPairs.length > 0) {
    lines.push("- **PROIBIDO** combinar ferramentas de categorias diferentes no mesmo turno.");
  }

  const toolFacts = formatPriorToolFactsForReplyOnly(opts.priorSuccessfulToolOutcomes);
  if (toolFacts) {
    lines.push("", "[OpenConduit — factos das ferramentas deste turno]", toolFacts);
  }

  return `${lines.join("\n")}\n`;
}

/** Hints de execução para retry — inclui turnPlan para evitar re-parse no executor. */
export function buildRetryExecutionHints(opts: {
  turnPlan: ExecutionTurnPlan;
  replyOnly: boolean;
  priorSuccessfulToolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
}): NonNullable<AgentRuntimeExecuteInput["executionHints"]> {
  return {
    turnPlan: opts.turnPlan,
    replyOnlyRetry: opts.replyOnly,
    priorSuccessfulToolOutcomes: opts.replyOnly ? opts.priorSuccessfulToolOutcomes : undefined,
  };
}

/** Garante turnPlan nos hints de entrada (runtime → executor). */
export function ensureTurnPlanInInput(
  input: AgentRuntimeExecuteInput,
  availableToolNames?: string[],
): AgentRuntimeExecuteInput {
  if (input.executionHints?.turnPlan) return input;
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: input.behaviorConfig,
    userMessage: input.message.body ?? "",
    availableToolNames,
  });
  return {
    ...input,
    executionHints: { ...input.executionHints, turnPlan },
  };
}
